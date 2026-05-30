/**
 * Cloudflare R2 storage adapter (S3-compatible)
 *
 * Activated when R2_BUCKET + R2_ENDPOINT + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY
 * are all set in the environment. When active, it:
 *
 *  1. Patches `fs.promises.readFile / writeFile / unlink` so any path under
 *     `config.upload.dir` is transparently routed to R2 instead of the local
 *     filesystem. This lets the existing signatureService.embedSignaturesIntoPdf
 *     code work unchanged on Render's ephemeral filesystem.
 *
 *  2. Exports a custom `multer.StorageEngine` that streams incoming uploads
 *     directly to R2 (memory-buffered to keep them off Render's ephemeral
 *     /tmp) and sets `req.file.path` to the R2 key so downstream code thinks
 *     the file lives at a normal path.
 *
 * Failure mode: if R2 is misconfigured, install() throws on startup so the
 * problem is visible immediately instead of silently corrupting uploads.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const config = require('../config');
const logger = require('../utils/logger');

let s3Client = null;
let r2Config = null;
let installed = false;

function isEnabled() {
    return !!(
        process.env.R2_BUCKET &&
        process.env.R2_ENDPOINT &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY
    );
}

function getR2Config() {
    if (r2Config) return r2Config;
    r2Config = {
        bucket: process.env.R2_BUCKET,
        endpoint: process.env.R2_ENDPOINT,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        region: process.env.R2_REGION || 'auto',
        prefix: process.env.R2_PREFIX || ''
    };
    return r2Config;
}

function getClient() {
    if (s3Client) return s3Client;
    const { S3Client } = require('@aws-sdk/client-s3');
    const cfg = getR2Config();
    s3Client = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        credentials: {
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey
        },
        forcePathStyle: true
    });
    return s3Client;
}

function isUploadPath(filePath) {
    if (!filePath) return false;
    const resolved = path.resolve(String(filePath));
    const uploadRoot = path.resolve(config.upload.dir);
    return resolved.startsWith(uploadRoot);
}

function toR2Key(filePath) {
    const cfg = getR2Config();
    const resolved = path.resolve(String(filePath));
    const uploadRoot = path.resolve(config.upload.dir);
    const rel = path.relative(uploadRoot, resolved).replace(/\\/g, '/');
    return cfg.prefix ? `${cfg.prefix.replace(/\/$/, '')}/${rel}` : rel;
}

async function r2PutBuffer(key, buffer, contentType = 'application/octet-stream') {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const cfg = getR2Config();
    await getClient().send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType
    }));
}

async function r2GetBuffer(key) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const cfg = getR2Config();
    const response = await getClient().send(new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key
    }));
    const chunks = [];
    for await (const chunk of response.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function r2Delete(key) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const cfg = getR2Config();
    await getClient().send(new DeleteObjectCommand({
        Bucket: cfg.bucket,
        Key: key
    }));
}

async function r2Head(key) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    const cfg = getR2Config();
    try {
        await getClient().send(new HeadObjectCommand({
            Bucket: cfg.bucket,
            Key: key
        }));
        return true;
    } catch {
        return false;
    }
}

function install() {
    if (installed) return;
    if (!isEnabled()) {
        logger.info('[r2] Not configured - using local filesystem');
        return;
    }
    try {
        require.resolve('@aws-sdk/client-s3');
    } catch {
        throw new Error('R2 is enabled but @aws-sdk/client-s3 is not installed. Run: npm install @aws-sdk/client-s3');
    }
    getClient();
    installed = true;

    const cfg = getR2Config();
    logger.info(`[r2] Enabled - bucket=${cfg.bucket}, endpoint=${cfg.endpoint}`);

    const originalReadFile = fs.promises.readFile;
    const originalWriteFile = fs.promises.writeFile;
    const originalUnlink = fs.promises.unlink;
    const originalAccess = fs.promises.access;

    fs.promises.readFile = async function patchedReadFile(filePath, options) {
        if (!isUploadPath(filePath)) return originalReadFile.call(this, filePath, options);
        try {
            const buffer = await r2GetBuffer(toR2Key(filePath));
            return options?.encoding ? buffer.toString(options.encoding) : buffer;
        } catch (error) {
            logger.error(`[r2] read failed for ${filePath}`, { error: error.message });
            throw Object.assign(
                new Error(`ENOENT: r2 object not found, open '${filePath}'`),
                { code: 'ENOENT', path: filePath }
            );
        }
    };

    fs.promises.writeFile = async function patchedWriteFile(filePath, data, options) {
        if (!isUploadPath(filePath)) return originalWriteFile.call(this, filePath, data, options);
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, options?.encoding || 'utf8');
        const ct = filePath.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
        await r2PutBuffer(toR2Key(filePath), buffer, ct);
    };

    fs.promises.unlink = async function patchedUnlink(filePath) {
        if (!isUploadPath(filePath)) return originalUnlink.call(this, filePath);
        try { await r2Delete(toR2Key(filePath)); } catch (e) {
            logger.warn(`[r2] unlink failed (ignoring) for ${filePath}: ${e.message}`);
        }
    };

    fs.promises.access = async function patchedAccess(filePath, mode) {
        if (!isUploadPath(filePath)) return originalAccess.call(this, filePath, mode);
        const exists = await r2Head(toR2Key(filePath));
        if (!exists) throw Object.assign(
            new Error(`ENOENT: no such file '${filePath}'`),
            { code: 'ENOENT', path: filePath }
        );
    };
}

/**
 * Custom multer storage engine that streams uploads directly into R2.
 * Sets req.file.path to the local "virtual" path (under config.upload.dir)
 * so downstream code that stores/reads the path keeps working unchanged.
 */
function multerStorage() {
    return {
        _handleFile(req, file, cb) {
            const ext = path.extname(file.originalname || '').toLowerCase();
            const filename = `${crypto.randomUUID()}${ext}`;
            const virtualPath = path.join(config.upload.dir, filename);
            const key = toR2Key(virtualPath);

            const chunks = [];
            let size = 0;
            file.stream.on('data', (chunk) => {
                chunks.push(chunk);
                size += chunk.length;
            });
            file.stream.on('error', cb);
            file.stream.on('end', async () => {
                try {
                    const buffer = Buffer.concat(chunks);
                    await r2PutBuffer(key, buffer, file.mimetype || 'application/octet-stream');
                    cb(null, {
                        filename,
                        path: virtualPath,
                        size,
                        destination: config.upload.dir
                    });
                } catch (err) {
                    cb(err);
                }
            });
        },
        _removeFile(req, file, cb) {
            r2Delete(toR2Key(file.path))
                .then(() => cb(null))
                .catch(cb);
        }
    };
}

module.exports = { isEnabled, install, multerStorage };

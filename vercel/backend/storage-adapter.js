/**
 * Vercel Blob Storage Adapter
 *
 * Replaces filesystem-based file storage with Vercel Blob so uploads survive
 * across serverless invocations. Wraps Node's `fs.promises.readFile` and
 * `fs.promises.writeFile` for paths that match the upload directory pattern,
 * transparently redirecting them to Vercel Blob.
 *
 * Activation: set BLOB_READ_WRITE_TOKEN in the Vercel project's environment.
 * Then `require('./storage-adapter').install()` from your serverless entry.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let blob;
try {
    blob = require('@vercel/blob');
} catch (e) {
    blob = null;
}

const UPLOAD_DIR_MARKER = process.env.UPLOAD_DIR || '/tmp/signpro-uploads';
const BLOB_PREFIX = 'documents/';

function isUploadPath(filePath) {
    if (!filePath) return false;
    const resolved = path.resolve(String(filePath));
    return resolved.startsWith(path.resolve(UPLOAD_DIR_MARKER));
}

function toBlobKey(filePath) {
    const resolved = path.resolve(String(filePath));
    const base = path.resolve(UPLOAD_DIR_MARKER);
    const rel = path.relative(base, resolved).replace(/\\/g, '/');
    return `${BLOB_PREFIX}${rel}`;
}

function install() {
    if (!blob) {
        throw new Error('@vercel/blob is not installed - run `npm install @vercel/blob`');
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new Error('BLOB_READ_WRITE_TOKEN env var is required');
    }

    const originalReadFile = fs.promises.readFile;
    const originalWriteFile = fs.promises.writeFile;
    const originalUnlink = fs.promises.unlink;

    fs.promises.readFile = async function patchedReadFile(filePath, options) {
        if (!isUploadPath(filePath)) {
            return originalReadFile.call(this, filePath, options);
        }
        const key = toBlobKey(filePath);
        const { url } = await blob.head(key, { token: process.env.BLOB_READ_WRITE_TOKEN });
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Blob read failed for ${key}: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        if (options?.encoding) return buffer.toString(options.encoding);
        return buffer;
    };

    fs.promises.writeFile = async function patchedWriteFile(filePath, data, options) {
        if (!isUploadPath(filePath)) {
            return originalWriteFile.call(this, filePath, data, options);
        }
        const key = toBlobKey(filePath);
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        await blob.put(key, buffer, {
            token: process.env.BLOB_READ_WRITE_TOKEN,
            access: 'public',
            allowOverwrite: true,
            addRandomSuffix: false
        });
    };

    fs.promises.unlink = async function patchedUnlink(filePath) {
        if (!isUploadPath(filePath)) {
            return originalUnlink.call(this, filePath);
        }
        const key = toBlobKey(filePath);
        try {
            await blob.del(key, { token: process.env.BLOB_READ_WRITE_TOKEN });
        } catch {}
    };

    return { uninstall: () => {
        fs.promises.readFile = originalReadFile;
        fs.promises.writeFile = originalWriteFile;
        fs.promises.unlink = originalUnlink;
    }};
}

module.exports = { install };

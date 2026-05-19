'use strict';

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const config = require('../config');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');
const { parsePdf, ParseError } = require('./pdfParser');
const { parseDocx } = require('./docxParser');
const auditService = require('./auditService');

const MIME_TO_TYPE = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
};

async function ensureUploadDir() {
    await fs.mkdir(config.upload.dir, { recursive: true });
}

async function createDocumentFromUpload({ user, file, title, description, expiresAt, requestContext }) {
    if (!file) throw makeError('No file uploaded', 400, 'NO_FILE');
    if (!MIME_TO_TYPE[file.mimetype]) {
        await safeUnlink(file.path);
        throw makeError(`Unsupported file type: ${file.mimetype}`, 415, 'UNSUPPORTED_FORMAT');
    }
    if (file.size > config.upload.maxFileSizeMb * 1024 * 1024) {
        await safeUnlink(file.path);
        throw makeError('File exceeds maximum size', 413, 'FILE_TOO_LARGE');
    }

    const documentType = MIME_TO_TYPE[file.mimetype];
    const buffer = await fs.readFile(file.path);
    const fileHash = cryptoUtils.sha256(buffer);
    const storedFilename = file.filename || `${uuidv4()}${path.extname(file.originalname)}`;
    const storagePath = file.path;

    const result = await db.query(
        `INSERT INTO documents (
            owner_id, title, description, document_type, status,
            original_filename, stored_filename, storage_path,
            file_size_bytes, mime_type, file_hash_sha256, expires_at
        ) VALUES ($1, $2, $3, $4, 'uploaded', $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
            user.id,
            title || file.originalname,
            description || null,
            documentType,
            file.originalname,
            storedFilename,
            storagePath,
            file.size,
            file.mimetype,
            fileHash,
            expiresAt || null
        ]
    );
    const document = result.rows[0];

    await auditService.record({
        actor_user_id: user.id,
        actor_email: user.email,
        action: 'document_uploaded',
        entity_type: 'document',
        entity_id: document.id,
        document_id: document.id,
        description: `Uploaded document "${document.title}" (${documentType}, ${file.size} bytes)`,
        ip_address: requestContext?.ip,
        user_agent: requestContext?.userAgent,
        metadata: { file_hash: fileHash, size: file.size }
    });

    return document;
}

async function parseDocument(documentId, options = {}) {
    const result = await db.query('SELECT * FROM documents WHERE id = $1', [documentId]);
    if (result.rows.length === 0) throw makeError('Document not found', 404, 'NOT_FOUND');
    const document = result.rows[0];

    await db.query("UPDATE documents SET status = 'parsing' WHERE id = $1", [documentId]);

    try {
        const parsed = document.document_type === 'pdf'
            ? await parsePdf(document.storage_path, options)
            : await parseDocx(document.storage_path, { ...options, title: document.title });

        const pageDimensions = parsed.pages.map(p => ({
            page: p.pageNumber,
            width: p.width,
            height: p.height,
            rotation: p.rotation
        }));

        const renderedPages = parsed.pages.map(p => ({
            page: p.pageNumber,
            hasRender: !!p.renderedBase64,
            width: p.width,
            height: p.height,
            textPreview: (p.textContent || '').slice(0, 500)
        }));

        await db.query(
            `UPDATE documents
             SET status = 'ready',
                 page_count = $2,
                 page_dimensions = $3,
                 extracted_text = $4,
                 rendered_pages = $5,
                 parse_error = NULL
             WHERE id = $1`,
            [
                documentId,
                parsed.pageCount,
                JSON.stringify(pageDimensions),
                parsed.fullText || null,
                JSON.stringify(renderedPages)
            ]
        );

        await auditService.record({
            actor_user_id: document.owner_id,
            action: 'document_parsed',
            entity_type: 'document',
            entity_id: documentId,
            document_id: documentId,
            description: `Parsed document: ${parsed.pageCount} page(s)`,
            metadata: { source: parsed.originalFormat || document.document_type }
        });

        return {
            documentId,
            pageCount: parsed.pageCount,
            pages: parsed.pages,
            metadata: parsed.metadata,
            pageDimensions
        };
    } catch (error) {
        const errorMessage = error instanceof ParseError
            ? `[${error.code}] ${error.message}`
            : error.message;
        await db.query(
            "UPDATE documents SET status = 'failed', parse_error = $2 WHERE id = $1",
            [documentId, errorMessage]
        );
        logger.error('Document parsing failed', { documentId, error: errorMessage });
        throw error instanceof ParseError
            ? makeError(error.message, 422, error.code)
            : makeError(`Parse failed: ${error.message}`, 500, 'PARSE_FAILED');
    }
}

async function getDocumentForUser(documentId, userId) {
    const result = await db.query(
        `SELECT d.*,
                COUNT(DISTINCT sr.id) FILTER (WHERE sr.status = 'pending') AS pending_signatures,
                COUNT(DISTINCT sr.id) FILTER (WHERE sr.status = 'signed') AS completed_signatures,
                COUNT(DISTINCT sr.id) AS total_signatures
         FROM documents d
         LEFT JOIN signature_requests sr ON sr.document_id = d.id
         WHERE d.id = $1 AND d.owner_id = $2
         GROUP BY d.id`,
        [documentId, userId]
    );
    return result.rows[0] || null;
}

async function listDocumentsForUser(userId, { status, limit = 50, offset = 0 } = {}) {
    const params = [userId];
    let where = 'd.owner_id = $1';
    if (status) {
        params.push(status);
        where += ` AND d.status = $${params.length}`;
    }
    params.push(limit, offset);
    const result = await db.query(
        `SELECT d.id, d.title, d.status, d.document_type, d.page_count,
                d.created_at, d.updated_at, d.expires_at,
                COUNT(DISTINCT sr.id) AS signature_count,
                COUNT(DISTINCT sr.id) FILTER (WHERE sr.status = 'signed') AS signed_count
         FROM documents d
         LEFT JOIN signature_requests sr ON sr.document_id = d.id
         WHERE ${where}
         GROUP BY d.id
         ORDER BY d.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    );
    return result.rows;
}

async function safeUnlink(filePath) {
    try { await fs.unlink(filePath); } catch {}
}

function makeError(message, statusCode, code) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

module.exports = {
    ensureUploadDir,
    createDocumentFromUpload,
    parseDocument,
    getDocumentForUser,
    listDocumentsForUser
};

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { body, param } = require('express-validator');
const db = require('../config/database');
const config = require('../config');
const auth = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../middleware/errorHandler');
const { handleValidation, sanitizeFilename } = require('../utils/validators');
const documentService = require('../services/documentService');
const auditService = require('../services/auditService');

const router = express.Router();

const storage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
        try {
            await fs.mkdir(config.upload.dir, { recursive: true });
            cb(null, config.upload.dir);
        } catch (err) { cb(err); }
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '');
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: config.upload.maxFileSizeMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
    }
});

router.post('/upload',
    auth.requireAuth,
    uploadLimiter,
    upload.single('document'),
    asyncHandler(async (req, res) => {
        const document = await documentService.createDocumentFromUpload({
            user: req.user,
            file: req.file,
            title: req.body.title,
            description: req.body.description,
            expiresAt: req.body.expires_at,
            requestContext: { ip: req.ip, userAgent: req.get('user-agent') }
        });
        let parseResult = null;
        if (req.body.parse !== 'false') {
            try {
                parseResult = await documentService.parseDocument(document.id, {
                    renderPages: req.body.render !== 'false'
                });
            } catch (error) {
                return res.status(201).json({
                    document,
                    parsed: false,
                    parseError: { code: error.code, message: error.message }
                });
            }
        }
        res.status(201).json({
            document: { ...document, status: parseResult ? 'ready' : document.status },
            parsed: !!parseResult,
            pageCount: parseResult?.pageCount,
            metadata: parseResult?.metadata
        });
    })
);

router.post('/:id/parse',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const doc = await documentService.getDocumentForUser(req.params.id, req.user.id);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        const result = await documentService.parseDocument(req.params.id, {
            renderPages: req.query.render !== 'false'
        });
        res.json(result);
    })
);

router.get('/',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
        const documents = await documentService.listDocumentsForUser(req.user.id, {
            status: req.query.status,
            limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
            offset: parseInt(req.query.offset, 10) || 0
        });
        res.json({ documents, count: documents.length });
    })
);

router.get('/:id',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const doc = await documentService.getDocumentForUser(req.params.id, req.user.id);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        const sigs = await db.query(
            `SELECT id, signer_email, signer_name, status, signing_order,
                    sent_at, first_viewed_at, signed_at, declined_at, expires_at
             FROM signature_requests WHERE document_id = $1
             ORDER BY signing_order, created_at`,
            [req.params.id]
        );
        res.json({ document: doc, signatureRequests: sigs.rows });
    })
);

router.get('/:id/pages',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const doc = await documentService.getDocumentForUser(req.params.id, req.user.id);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        const parsed = await documentService.parseDocument(req.params.id, {
            renderPages: true
        });
        res.json({
            documentId: req.params.id,
            pageCount: parsed.pageCount,
            pages: parsed.pages.map(p => ({
                pageNumber: p.pageNumber,
                width: p.width,
                height: p.height,
                rotation: p.rotation,
                imageDataUrl: p.renderedBase64
                    ? `data:image/png;base64,${p.renderedBase64}`
                    : null,
                textPreview: (p.textContent || '').slice(0, 200)
            }))
        });
    })
);

router.get('/:id/download',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const doc = await documentService.getDocumentForUser(req.params.id, req.user.id);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        const variant = req.query.variant || 'signed';
        let filePath = doc.storage_path;
        let filename = doc.original_filename;
        if (variant === 'signed') {
            const evidence = await db.query(
                `SELECT signed_pdf_path FROM signature_evidence
                 WHERE document_id = $1 AND signed_pdf_path IS NOT NULL
                 ORDER BY created_at DESC LIMIT 1`,
                [req.params.id]
            );
            if (evidence.rows[0]?.signed_pdf_path) {
                filePath = evidence.rows[0].signed_pdf_path;
                filename = `signed_${sanitizeFilename(doc.title)}.pdf`;
            }
        }
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: 'File not found on disk' });
        }
        await auditService.record({
            actor_user_id: req.user.id,
            actor_email: req.user.email,
            action: 'document_downloaded',
            entity_type: 'document',
            entity_id: req.params.id,
            document_id: req.params.id,
            description: `Downloaded ${variant} variant`,
            ip_address: req.ip
        });
        res.download(filePath, filename);
    })
);

router.delete('/:id',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await db.query(
            `UPDATE documents SET status = 'voided'
             WHERE id = $1 AND owner_id = $2 AND status NOT IN ('completed', 'voided')
             RETURNING id`,
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found or already voided' });
        }
        await db.query(
            `UPDATE signature_requests SET status = 'cancelled'
             WHERE document_id = $1 AND status IN ('pending', 'viewed')`,
            [req.params.id]
        );
        await auditService.record({
            actor_user_id: req.user.id,
            action: 'document_voided',
            entity_type: 'document',
            entity_id: req.params.id,
            document_id: req.params.id,
            description: 'Document voided'
        });
        res.json({ success: true });
    })
);

router.get('/:id/history',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const doc = await documentService.getDocumentForUser(req.params.id, req.user.id);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        const history = await auditService.getDocumentHistory(req.params.id);
        res.json({ documentId: req.params.id, events: history });
    })
);

module.exports = router;

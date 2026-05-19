'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const db = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { handleValidation } = require('../utils/validators');
const signatureService = require('../services/signatureService');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');

const router = express.Router();

router.post('/requests',
    auth.requireAuth,
    body('documentId').isUUID(),
    body('recipients').isArray({ min: 1 }),
    body('recipients.*.email').isEmail(),
    body('recipients.*.name').isString().trim().isLength({ min: 1 }),
    body('recipients.*.fields').isArray({ min: 1 }),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await signatureService.createSignatureRequests({
            documentId: req.body.documentId,
            sender: req.user,
            recipients: req.body.recipients,
            notify: req.body.notify || { email: true, sms: false },
            requestContext: { ip: req.ip, userAgent: req.get('user-agent') }
        });
        res.status(201).json(result);
    })
);

router.get('/session/:token',
    param('token').isLength({ min: 32, max: 128 }),
    handleValidation,
    asyncHandler(async (req, res) => {
        const session = await signatureService.loadSigningSession(
            req.params.token,
            { ip: req.ip, userAgent: req.get('user-agent') }
        );
        res.json(session);
    })
);

router.get('/session/:token/pages',
    param('token').isLength({ min: 32, max: 128 }),
    handleValidation,
    asyncHandler(async (req, res) => {
        const sigResult = await db.query(
            `SELECT sr.document_id, sr.status, sr.expires_at
             FROM signature_requests sr WHERE sr.access_token = $1`,
            [req.params.token]
        );
        if (sigResult.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid signing link' });
        }
        const sr = sigResult.rows[0];
        if (new Date(sr.expires_at) < new Date()) {
            return res.status(410).json({ error: 'Signing link expired' });
        }
        const documentService = require('../services/documentService');
        const docResult = await db.query(
            'SELECT * FROM documents WHERE id = $1', [sr.document_id]
        );
        const doc = docResult.rows[0];
        if (!doc.rendered_pages || doc.page_count === null) {
            await documentService.parseDocument(sr.document_id, { renderPages: true });
        }
        const parsed = await documentService.parseDocument(sr.document_id, { renderPages: true });
        res.json({
            pageCount: parsed.pageCount,
            pages: parsed.pages.map(p => ({
                pageNumber: p.pageNumber,
                width: p.width,
                height: p.height,
                imageDataUrl: p.renderedBase64
                    ? `data:image/png;base64,${p.renderedBase64}`
                    : null
            }))
        });
    })
);

router.post('/session/:token/complete',
    param('token').isLength({ min: 32, max: 128 }),
    body('fieldValues').isArray(),
    body('consent.accepted').isBoolean(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await signatureService.completeSignature({
            accessToken: req.params.token,
            fieldValues: req.body.fieldValues,
            consent: req.body.consent,
            verificationCode: req.body.verificationCode,
            requestContext: { ip: req.ip, userAgent: req.get('user-agent') }
        });
        res.json(result);
    })
);

router.post('/session/:token/decline',
    param('token').isLength({ min: 32, max: 128 }),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await signatureService.declineSignature({
            accessToken: req.params.token,
            reason: req.body?.reason,
            requestContext: { ip: req.ip, userAgent: req.get('user-agent') }
        });
        res.json({ success: true, status: result.status });
    })
);

router.post('/:id/resend',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await db.query(
            `SELECT sr.*, d.id AS doc_id, d.title AS doc_title,
                    u.id AS sender_user_id, u.full_name AS sender_name, u.email AS sender_email
             FROM signature_requests sr
             JOIN documents d ON d.id = sr.document_id
             JOIN users u ON u.id = sr.sender_id
             WHERE sr.id = $1 AND sr.sender_id = $2 AND sr.status IN ('pending', 'viewed')`,
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Signature request not found or already finalized' });
        }
        const sr = result.rows[0];
        const sender = { id: sr.sender_user_id, full_name: sr.sender_name, email: sr.sender_email };
        const document = { id: sr.doc_id, title: sr.doc_title };
        const emailResult = await emailService.sendSignatureRequestEmail({
            signatureRequest: sr, document, sender
        });
        let smsResult = null;
        if (req.body?.sms === true && sr.signer_phone) {
            smsResult = await smsService.sendSignatureRequestSms({
                signatureRequest: sr, document, sender
            });
        }
        await db.query(
            `UPDATE signature_requests
             SET reminder_count = reminder_count + 1, last_reminder_at = NOW()
             WHERE id = $1`,
            [sr.id]
        );
        res.json({ email: emailResult, sms: smsResult });
    })
);

router.delete('/:id',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await db.query(
            `UPDATE signature_requests SET status = 'cancelled'
             WHERE id = $1 AND sender_id = $2 AND status IN ('pending', 'viewed')
             RETURNING id`,
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cannot cancel - not found or finalized' });
        }
        res.json({ success: true });
    })
);

router.post('/verify',
    body('documentId').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await signatureService.verifySignature({
            documentId: req.body.documentId,
            hmac: req.body.hmac
        });
        res.json(result);
    })
);

module.exports = router;

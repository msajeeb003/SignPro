'use strict';

const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const smsService = require('../services/smsService');
const { handleValidation } = require('../utils/validators');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.post('/send',
    auth.requireAuth,
    body('to').matches(/^\+[1-9]\d{6,14}$/).withMessage('to must be E.164 format'),
    body('body').isString().isLength({ min: 1, max: 1600 }),
    body('signature_request_id').optional().isUUID(),
    body('document_id').optional().isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await smsService.sendSms({
            userId: req.user.id,
            to: req.body.to,
            body: req.body.body,
            signatureRequestId: req.body.signature_request_id,
            documentId: req.body.document_id
        });
        if (!result.success) {
            return res.status(502).json(result);
        }
        res.json(result);
    })
);

router.post('/signature-request/:id',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
        const db = require('../config/database');
        const sigResult = await db.query(
            `SELECT sr.*, d.title AS doc_title,
                    u.id AS sender_user_id, u.full_name AS sender_name, u.email AS sender_email
             FROM signature_requests sr
             JOIN documents d ON d.id = sr.document_id
             JOIN users u ON u.id = sr.sender_id
             WHERE sr.id = $1 AND sr.sender_id = $2`,
            [req.params.id, req.user.id]
        );
        if (sigResult.rows.length === 0) {
            return res.status(404).json({ error: 'Signature request not found' });
        }
        const sr = sigResult.rows[0];
        if (!sr.signer_phone) {
            return res.status(400).json({ error: 'Recipient has no phone number on file' });
        }
        const result = await smsService.sendSignatureRequestSms({
            signatureRequest: sr,
            document: { id: sr.document_id, title: sr.doc_title },
            sender: { id: sr.sender_user_id, full_name: sr.sender_name, email: sr.sender_email }
        });
        res.json(result);
    })
);

module.exports = router;

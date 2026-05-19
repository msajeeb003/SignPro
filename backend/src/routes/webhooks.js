'use strict';

const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const db = require('../config/database');
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { handleValidation } = require('../utils/validators');
const { extensionPollLimiter } = require('../middleware/rateLimiter');
const smsService = require('../services/smsService');
const auditService = require('../services/auditService');

const router = express.Router();

/**
 * Extension polling endpoint
 * The browser extension calls this on an interval (every 30-60s by default)
 * to fetch unread notifications and pending signature requests for the user.
 *
 * Response shape:
 *   {
 *     pollTimestamp: ISO,
 *     pendingSignatures: [...],
 *     notifications: [...],
 *     unreadCount: number
 *   }
 */
router.get('/extension/poll',
    auth.requireExtensionToken,
    extensionPollLimiter,
    asyncHandler(async (req, res) => {
        const since = req.query.since
            ? new Date(req.query.since)
            : new Date(Date.now() - 24 * 60 * 60 * 1000);

        const pendingResult = await db.query(
            `SELECT sr.id AS signature_request_id,
                    sr.signer_email,
                    sr.signer_name,
                    sr.status,
                    sr.expires_at,
                    sr.access_token,
                    sr.sent_at,
                    sr.first_viewed_at,
                    sr.created_at,
                    d.id AS document_id,
                    d.title AS document_title,
                    d.document_type,
                    d.page_count,
                    u.full_name AS sender_name,
                    u.email AS sender_email
             FROM signature_requests sr
             JOIN documents d ON d.id = sr.document_id
             JOIN users u ON u.id = sr.sender_id
             WHERE sr.signer_user_id = $1
               AND sr.status IN ('pending', 'viewed')
               AND sr.expires_at > NOW()
             ORDER BY sr.created_at DESC
             LIMIT 50`,
            [req.user.id]
        );

        const notificationsResult = await db.query(
            `SELECT n.id, n.signature_request_id, n.document_id, n.channel, n.status,
                    n.subject, n.body_preview, n.sent_at, n.read_at, n.created_at,
                    d.title AS document_title,
                    sr.signer_email,
                    sr.signer_name
             FROM notification_logs n
             LEFT JOIN documents d ON d.id = n.document_id
             LEFT JOIN signature_requests sr ON sr.id = n.signature_request_id
             WHERE n.user_id = $1
               AND n.channel = 'extension'
               AND n.created_at > $2
             ORDER BY n.created_at DESC
             LIMIT 50`,
            [req.user.id, since]
        );

        const unreadResult = await db.query(
            `SELECT COUNT(*)::INT AS count
             FROM notification_logs
             WHERE user_id = $1 AND channel = 'extension' AND read_at IS NULL`,
            [req.user.id]
        );

        const signingBaseUrl = `${config.frontendUrl}/sign`;
        const pending = pendingResult.rows.map(p => ({
            ...p,
            signing_url: `${signingBaseUrl}/${p.access_token}`,
            access_token: undefined
        }));

        res.json({
            pollTimestamp: new Date().toISOString(),
            user: {
                id: req.user.id,
                email: req.user.email,
                full_name: req.user.full_name
            },
            pendingSignatures: pending,
            notifications: notificationsResult.rows.map(n => ({
                ...n,
                signing_url: n.signature_request_id
                    ? `${signingBaseUrl}/${n.signature_request_id}`
                    : null
            })),
            unreadCount: unreadResult.rows[0].count
        });
    })
);

router.post('/extension/notifications/read',
    auth.requireExtensionToken,
    body('notification_ids').isArray(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const ids = req.body.notification_ids;
        if (ids.length === 0) return res.json({ marked: 0 });
        const result = await db.query(
            `UPDATE notification_logs
             SET read_at = NOW(), status = 'read'
             WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL
             RETURNING id`,
            [req.user.id, ids]
        );
        res.json({ marked: result.rows.length });
    })
);

router.post('/extension/heartbeat',
    auth.requireExtensionToken,
    asyncHandler(async (req, res) => {
        res.json({
            ok: true,
            serverTime: new Date().toISOString(),
            user: { id: req.user.id, email: req.user.email }
        });
    })
);

router.post('/extension/sse-token',
    auth.requireExtensionToken,
    asyncHandler(async (req, res) => {
        res.json({
            sseUrl: `${config.apiBaseUrl}/api/webhooks/extension/stream?token=${req.headers.authorization?.slice(7)}`,
            heartbeatInterval: 30000
        });
    })
);

router.post('/twilio/status',
    asyncHandler(async (req, res) => {
        await smsService.handleStatusCallback(req.body);
        res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    })
);

router.post('/email/bounce',
    asyncHandler(async (req, res) => {
        const { message_id, event, recipient } = req.body || {};
        if (message_id) {
            await db.query(
                `UPDATE notification_logs
                 SET status = $2, error_message = COALESCE(error_message, $3)
                 WHERE provider_message_id = $1`,
                [
                    message_id,
                    event === 'bounce' ? 'bounced' : 'failed',
                    `Email ${event} for ${recipient}`
                ]
            );
        }
        res.json({ ok: true });
    })
);

router.get('/subscriptions',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
        const result = await db.query(
            `SELECT id, url, events, is_active, last_triggered_at,
                    failure_count, created_at
             FROM webhook_subscriptions
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json({ subscriptions: result.rows });
    })
);

router.post('/subscriptions',
    auth.requireAuth,
    body('url').isURL({ protocols: ['http', 'https'], require_protocol: true }),
    body('events').optional().isArray(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const cryptoUtils = require('../utils/crypto');
        const result = await db.query(
            `INSERT INTO webhook_subscriptions (user_id, url, secret, events, is_active)
             VALUES ($1, $2, $3, $4, TRUE)
             RETURNING id, url, events, is_active, created_at`,
            [
                req.user.id,
                req.body.url,
                cryptoUtils.generateToken(24),
                req.body.events || ['*']
            ]
        );
        res.status(201).json({ subscription: result.rows[0] });
    })
);

module.exports = router;

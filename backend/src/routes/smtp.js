'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const db = require('../config/database');
const cryptoUtils = require('../utils/crypto');
const emailService = require('../services/emailService');
const { handleValidation } = require('../utils/validators');
const { asyncHandler } = require('../middleware/errorHandler');
const auditService = require('../services/auditService');

const router = express.Router();

router.get('/', auth.requireAuth, asyncHandler(async (req, res) => {
    const result = await db.query(
        `SELECT id, name, host, port, secure, username, from_name, from_address,
                reply_to, is_default, is_verified, last_verified_at, created_at, updated_at
         FROM smtp_configurations
         WHERE user_id = $1
         ORDER BY is_default DESC, created_at DESC`,
        [req.user.id]
    );
    res.json({ configurations: result.rows });
}));

router.post('/',
    auth.requireAuth,
    body('host').isString().trim().isLength({ min: 1, max: 255 }),
    body('port').isInt({ min: 1, max: 65535 }),
    body('username').isString().trim().isLength({ min: 1, max: 255 }),
    body('password').isString().isLength({ min: 1 }),
    body('from_name').isString().trim().isLength({ min: 1, max: 255 }),
    body('from_address').isEmail(),
    body('secure').optional().isBoolean(),
    body('reply_to').optional({ nullable: true, checkFalsy: true }).isEmail(),
    body('name').optional().isString().trim().isLength({ max: 100 }),
    body('is_default').optional().isBoolean(),
    body('verify').optional().isBoolean(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const {
            host, port, username, password, from_name, from_address,
            secure = false, reply_to, name = 'Default', is_default = false,
            verify = true
        } = req.body;

        let isVerified = false;
        let verifyError = null;
        if (verify) {
            const verification = await emailService.verifySmtp({
                host, port, secure, username, password
            });
            isVerified = verification.ok;
            verifyError = verification.error;
        }

        if (verify && !isVerified) {
            return res.status(400).json({
                error: 'SMTP verification failed',
                details: verifyError
            });
        }

        const result = await db.transaction(async (client) => {
            if (is_default) {
                await client.query(
                    'UPDATE smtp_configurations SET is_default = FALSE WHERE user_id = $1',
                    [req.user.id]
                );
            }
            return client.query(
                `INSERT INTO smtp_configurations (
                    user_id, name, host, port, secure, username, password_encrypted,
                    from_name, from_address, reply_to, is_default,
                    is_verified, last_verified_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (user_id, name) DO UPDATE SET
                    host = EXCLUDED.host,
                    port = EXCLUDED.port,
                    secure = EXCLUDED.secure,
                    username = EXCLUDED.username,
                    password_encrypted = EXCLUDED.password_encrypted,
                    from_name = EXCLUDED.from_name,
                    from_address = EXCLUDED.from_address,
                    reply_to = EXCLUDED.reply_to,
                    is_default = EXCLUDED.is_default,
                    is_verified = EXCLUDED.is_verified,
                    last_verified_at = EXCLUDED.last_verified_at,
                    last_error = NULL
                RETURNING id, name, host, port, secure, username, from_name,
                          from_address, reply_to, is_default, is_verified, created_at`,
                [
                    req.user.id, name, host, port, secure, username,
                    cryptoUtils.encrypt(password), from_name, from_address,
                    reply_to || null, is_default,
                    isVerified, isVerified ? new Date() : null
                ]
            );
        });

        await auditService.record({
            actor_user_id: req.user.id,
            actor_email: req.user.email,
            action: 'smtp_configured',
            entity_type: 'smtp_configuration',
            entity_id: result.rows[0].id,
            description: `SMTP configured: ${host}:${port}`,
            ip_address: req.ip
        });

        res.status(201).json({ configuration: result.rows[0], verified: isVerified });
    })
);

router.put('/:id',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const existing = await db.query(
            'SELECT * FROM smtp_configurations WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Configuration not found' });
        }
        const updates = {};
        for (const key of ['host', 'port', 'secure', 'username', 'from_name', 'from_address', 'reply_to', 'name']) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        if (req.body.password) updates.password_encrypted = cryptoUtils.encrypt(req.body.password);
        const fields = Object.keys(updates);
        if (fields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
        const result = await db.query(
            `UPDATE smtp_configurations SET ${setClause}
             WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}
             RETURNING id, name, host, port, secure, username, from_name,
                       from_address, reply_to, is_default, is_verified`,
            [...Object.values(updates), req.params.id, req.user.id]
        );
        res.json({ configuration: result.rows[0] });
    })
);

router.post('/:id/test',
    auth.requireAuth,
    param('id').isUUID(),
    body('to').isEmail(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await db.query(
            `SELECT id, host, port, secure, username, password_encrypted,
                    from_name, from_address
             FROM smtp_configurations WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Configuration not found' });
        }
        const cfg = result.rows[0];
        const password = cryptoUtils.decrypt(cfg.password_encrypted);
        const verification = await emailService.verifySmtp({
            host: cfg.host, port: cfg.port, secure: cfg.secure,
            username: cfg.username, password
        });
        if (!verification.ok) {
            await db.query(
                'UPDATE smtp_configurations SET last_error = $2 WHERE id = $1',
                [cfg.id, verification.error]
            );
            return res.status(400).json({ ok: false, error: verification.error });
        }
        const sent = await emailService.sendEmail({
            userId: req.user.id,
            to: req.body.to,
            subject: 'SignPro - SMTP Test',
            html: '<p>This is a test email from your SignPro SMTP configuration. If you received this, your settings work correctly.</p>',
            text: 'This is a test email from your SignPro SMTP configuration.'
        });
        await db.query(
            `UPDATE smtp_configurations
             SET is_verified = TRUE, last_verified_at = NOW(), last_error = NULL
             WHERE id = $1`,
            [cfg.id]
        );
        res.json({ ok: true, sent });
    })
);

router.delete('/:id',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        const result = await db.query(
            'DELETE FROM smtp_configurations WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    })
);

router.post('/:id/set-default',
    auth.requireAuth,
    param('id').isUUID(),
    handleValidation,
    asyncHandler(async (req, res) => {
        await db.transaction(async (client) => {
            await client.query(
                'UPDATE smtp_configurations SET is_default = FALSE WHERE user_id = $1',
                [req.user.id]
            );
            await client.query(
                'UPDATE smtp_configurations SET is_default = TRUE WHERE id = $1 AND user_id = $2',
                [req.params.id, req.user.id]
            );
        });
        res.json({ success: true });
    })
);

module.exports = router;

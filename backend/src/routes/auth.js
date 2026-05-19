'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { body } = require('express-validator');
const db = require('../config/database');
const config = require('../config');
const cryptoUtils = require('../utils/crypto');
const { handleValidation } = require('../utils/validators');
const auth = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../middleware/errorHandler');
const auditService = require('../services/auditService');

const router = express.Router();

router.post('/register',
    authLimiter,
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 10 })
        .withMessage('Password must be at least 10 characters'),
    body('full_name').trim().isLength({ min: 2, max: 255 }),
    body('phone_number').optional().matches(/^\+[1-9]\d{6,14}$/)
        .withMessage('Phone number must be in E.164 format'),
    handleValidation,
    asyncHandler(async (req, res) => {
        const { email, password, full_name, phone_number, role } = req.body;
        const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
        const result = await db.query(
            `INSERT INTO users (email, password_hash, full_name, phone_number, role, is_verified)
             VALUES ($1, $2, $3, $4, $5, FALSE)
             RETURNING id, email, full_name, role, created_at`,
            [email, passwordHash, full_name, phone_number || null, role || 'sender']
        );
        const user = result.rows[0];
        await auditService.record({
            actor_user_id: user.id,
            actor_email: user.email,
            action: 'user_registered',
            entity_type: 'user',
            entity_id: user.id,
            description: `User registered: ${user.email}`,
            ip_address: req.ip,
            user_agent: req.get('user-agent')
        });
        const accessToken = auth.signAccessToken({ sub: user.id, role: user.role });
        const refreshToken = auth.signRefreshToken({ sub: user.id });
        await db.query(
            `INSERT INTO user_sessions
             (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
            [user.id, cryptoUtils.hmac(refreshToken), req.ip, req.get('user-agent')]
        );
        res.status(201).json({ user, accessToken, refreshToken });
    })
);

router.post('/login',
    authLimiter,
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 1 }),
    handleValidation,
    asyncHandler(async (req, res) => {
        const { email, password } = req.body;
        const result = await db.query(
            `SELECT id, email, password_hash, full_name, role, is_active,
                    failed_attempts, locked_until
             FROM users WHERE email = $1`,
            [email]
        );
        const user = result.rows[0];
        if (!user || !user.is_active) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            return res.status(423).json({ error: 'Account locked. Try again later.' });
        }
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            await db.query(
                `UPDATE users SET failed_attempts = failed_attempts + 1,
                                  locked_until = CASE WHEN failed_attempts + 1 >= 10
                                                      THEN NOW() + INTERVAL '15 minutes'
                                                      ELSE locked_until END
                 WHERE id = $1`,
                [user.id]
            );
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        await db.query(
            `UPDATE users SET failed_attempts = 0, locked_until = NULL,
                              last_login_at = NOW(), last_login_ip = $2
             WHERE id = $1`,
            [user.id, req.ip]
        );
        const accessToken = auth.signAccessToken({ sub: user.id, role: user.role });
        const refreshToken = auth.signRefreshToken({ sub: user.id });
        await db.query(
            `INSERT INTO user_sessions
             (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
            [user.id, cryptoUtils.hmac(refreshToken), req.ip, req.get('user-agent')]
        );
        await auditService.record({
            actor_user_id: user.id,
            actor_email: user.email,
            action: 'user_login',
            entity_type: 'user',
            entity_id: user.id,
            description: 'User logged in',
            ip_address: req.ip,
            user_agent: req.get('user-agent')
        });
        delete user.password_hash;
        delete user.failed_attempts;
        delete user.locked_until;
        res.json({ user, accessToken, refreshToken });
    })
);

router.post('/refresh', asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
    let decoded;
    try {
        decoded = auth.verifyRefreshToken(refreshToken);
    } catch {
        return res.status(401).json({ error: 'Invalid refresh token' });
    }
    const tokenHash = cryptoUtils.hmac(refreshToken);
    const session = await db.query(
        `SELECT id FROM user_sessions
         WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
        [tokenHash]
    );
    if (session.rows.length === 0) {
        return res.status(401).json({ error: 'Session not found or revoked' });
    }
    const userResult = await db.query(
        'SELECT id, role, is_active FROM users WHERE id = $1', [decoded.sub]
    );
    if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
        return res.status(401).json({ error: 'User inactive' });
    }
    const accessToken = auth.signAccessToken({
        sub: userResult.rows[0].id,
        role: userResult.rows[0].role
    });
    res.json({ accessToken });
}));

router.post('/logout', auth.requireAuth, asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
        const tokenHash = cryptoUtils.hmac(refreshToken);
        await db.query(
            `UPDATE user_sessions SET revoked_at = NOW()
             WHERE refresh_token_hash = $1 AND user_id = $2`,
            [tokenHash, req.user.id]
        );
    }
    await auditService.record({
        actor_user_id: req.user.id,
        actor_email: req.user.email,
        action: 'user_logout',
        entity_type: 'user',
        entity_id: req.user.id,
        description: 'User logged out',
        ip_address: req.ip
    });
    res.json({ success: true });
}));

router.get('/me', auth.requireAuth, asyncHandler(async (req, res) => {
    const result = await db.query(
        `SELECT id, email, full_name, phone_number, role, is_verified,
                last_login_at, created_at
         FROM users WHERE id = $1`,
        [req.user.id]
    );
    res.json(result.rows[0]);
}));

router.post('/extension-token', auth.requireAuth, asyncHandler(async (req, res) => {
    const rawToken = cryptoUtils.generateToken(32);
    const tokenHash = cryptoUtils.hmac(rawToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    const result = await db.query(
        `INSERT INTO extension_tokens (user_id, token_hash, name, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, expires_at, created_at`,
        [req.user.id, tokenHash, req.body?.name || 'Browser Extension', expiresAt]
    );
    res.status(201).json({
        token: rawToken,
        tokenInfo: result.rows[0],
        warning: 'Store this token securely. It will not be shown again.'
    });
}));

router.delete('/extension-token/:id', auth.requireAuth, asyncHandler(async (req, res) => {
    const result = await db.query(
        `UPDATE extension_tokens SET revoked_at = NOW()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Token not found' });
    res.json({ success: true });
}));

module.exports = router;

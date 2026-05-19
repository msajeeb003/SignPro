'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');
const crypto = require('../utils/crypto');
const logger = require('../utils/logger');

function signAccessToken(payload) {
    return jwt.sign(payload, config.security.jwtSecret, {
        expiresIn: config.security.jwtExpiresIn,
        issuer: 'signpro'
    });
}

function signRefreshToken(payload) {
    return jwt.sign(payload, config.security.refreshSecret, {
        expiresIn: config.security.refreshExpiresIn,
        issuer: 'signpro'
    });
}

function verifyAccessToken(token) {
    return jwt.verify(token, config.security.jwtSecret, { issuer: 'signpro' });
}

function verifyRefreshToken(token) {
    return jwt.verify(token, config.security.refreshSecret, { issuer: 'signpro' });
}

function extractToken(req) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
    if (req.cookies && req.cookies.access_token) return req.cookies.access_token;
    return null;
}

async function requireAuth(req, res, next) {
    try {
        const token = extractToken(req);
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const decoded = verifyAccessToken(token);
        const result = await db.query(
            'SELECT id, email, full_name, role, is_active FROM users WHERE id = $1',
            [decoded.sub]
        );
        if (result.rows.length === 0 || !result.rows[0].is_active) {
            return res.status(401).json({ error: 'Invalid or inactive user' });
        }
        req.user = result.rows[0];
        req.tokenPayload = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        logger.warn('Auth failure', { error: error.message });
        return res.status(401).json({ error: 'Invalid authentication token' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

async function requireExtensionToken(req, res, next) {
    try {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Extension token required' });
        }
        const token = auth.slice(7);
        const tokenHash = crypto.hmac(token);
        const result = await db.query(
            `SELECT et.id, et.user_id, et.expires_at, et.revoked_at,
                    u.email, u.full_name, u.role, u.is_active
             FROM extension_tokens et
             JOIN users u ON u.id = et.user_id
             WHERE et.token_hash = $1`,
            [tokenHash]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid extension token' });
        }
        const row = result.rows[0];
        if (row.revoked_at) return res.status(401).json({ error: 'Token revoked' });
        if (new Date(row.expires_at) < new Date()) {
            return res.status(401).json({ error: 'Token expired' });
        }
        if (!row.is_active) return res.status(401).json({ error: 'User inactive' });

        await db.query(
            `UPDATE extension_tokens
             SET last_polled_at = NOW(),
                 last_polled_ip = $2,
                 poll_count = poll_count + 1
             WHERE id = $1`,
            [row.id, req.ip]
        );

        req.user = {
            id: row.user_id,
            email: row.email,
            full_name: row.full_name,
            role: row.role
        };
        req.extensionTokenId = row.id;
        next();
    } catch (error) {
        logger.error('Extension auth error', { error: error.message });
        return res.status(500).json({ error: 'Authentication error' });
    }
}

module.exports = {
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    requireAuth,
    requireRole,
    requireExtensionToken
};

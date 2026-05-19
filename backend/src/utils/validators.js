'use strict';

const { validationResult } = require('express-validator');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

function isEmail(value) {
    return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

function isE164(value) {
    return typeof value === 'string' && E164_RE.test(value.trim());
}

function isUuid(value) {
    return typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sanitizeFilename(name) {
    if (!name) return 'document';
    return String(name)
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 200);
}

function handleValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(e => ({
                field: e.path || e.param,
                message: e.msg
            }))
        });
    }
    next();
}

module.exports = { isEmail, isE164, isUuid, sanitizeFilename, handleValidation };

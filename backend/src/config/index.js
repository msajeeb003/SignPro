'use strict';

require('dotenv').config();
const path = require('path');

const required = (key, fallback) => {
    const value = process.env[key];
    if (value === undefined || value === '') {
        if (fallback !== undefined) return fallback;
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};

const asInt = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const asBool = (value, fallback = false) => {
    if (value === undefined || value === null) return fallback;
    return String(value).toLowerCase() === 'true';
};

const config = {
    env: process.env.NODE_ENV || 'development',
    port: asInt(process.env.PORT, 4000),
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:4000',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

    db: {
        connectionString: process.env.DATABASE_URL,
        host: process.env.PGHOST || 'localhost',
        port: asInt(process.env.PGPORT, 5432),
        database: process.env.PGDATABASE || 'signpro',
        user: process.env.PGUSER || 'signpro',
        password: process.env.PGPASSWORD || '',
        ssl: asBool(process.env.PG_SSL, false) ? { rejectUnauthorized: false } : false,
        max: asInt(process.env.PG_POOL_MAX, 20),
        idleTimeoutMillis: 30000
    },

    security: {
        jwtSecret: required('JWT_SECRET', 'dev_jwt_secret_change_in_production_must_be_long_enough'),
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
        refreshSecret: required('REFRESH_TOKEN_SECRET', 'dev_refresh_secret_change_in_production_must_be_long'),
        refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
        bcryptRounds: asInt(process.env.BCRYPT_ROUNDS, 12),
        signatureHmacSecret: required('SIGNATURE_HMAC_SECRET', 'dev_signature_hmac_secret_change_in_production')
    },

    upload: {
        dir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
        maxFileSizeMb: asInt(process.env.MAX_FILE_SIZE_MB, 25),
        allowedMimeTypes: (process.env.ALLOWED_MIME_TYPES ||
            'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            .split(',').map(s => s.trim())
    },

    smtp: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: asInt(process.env.SMTP_PORT, 587),
        secure: asBool(process.env.SMTP_SECURE, false),
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        fromName: process.env.SMTP_FROM_NAME || 'SignPro',
        fromAddress: process.env.SMTP_FROM_ADDRESS || 'no-reply@signpro.local'
    },

    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || ''
    },

    extension: {
        pollSecret: process.env.EXTENSION_POLL_SECRET || 'dev_extension_poll_secret',
        extensionId: process.env.EXTENSION_ID || ''
    },

    rateLimit: {
        windowMs: asInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
        max: asInt(process.env.RATE_LIMIT_MAX_REQUESTS, 200)
    },

    log: {
        level: process.env.LOG_LEVEL || 'info'
    }
};

module.exports = config;

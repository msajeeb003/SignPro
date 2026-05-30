'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

const config = require('./config');
const logger = require('./utils/logger');
const db = require('./config/database');
const { globalLimiter } = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const documentService = require('./services/documentService');
const signatureService = require('./services/signatureService');
const r2Storage = require('./services/r2Storage');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'", config.frontendUrl],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

const allowedOrigins = [config.frontendUrl];
if (config.extension.extensionId) {
    allowedOrigins.push(`chrome-extension://${config.extension.extensionId}`);
}
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || origin.startsWith('chrome-extension://')) {
            return callback(null, true);
        }
        callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.url === '/health' || req.url === '/api/health'
}));
app.use(globalLimiter);

app.get('/health', async (_req, res) => {
    const health = await db.healthCheck();
    res.status(health.healthy ? 200 : 503).json({
        status: health.healthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        database: health
    });
});

app.get('/api/health', async (_req, res) => {
    const health = await db.healthCheck();
    res.status(health.healthy ? 200 : 503).json({
        status: health.healthy ? 'ok' : 'degraded',
        database: health
    });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/signatures', require('./routes/signatures'));
app.use('/api/smtp', require('./routes/smtp'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/webhooks', require('./routes/webhooks'));

app.use(notFound);
app.use(errorHandler);

async function start() {
    r2Storage.install();
    await documentService.ensureUploadDir();
    await signatureService.ensureSignedDir();
    const server = app.listen(config.port, () => {
        logger.info(`SignPro API listening on port ${config.port} (env=${config.env})`);
        logger.info(`Frontend URL: ${config.frontendUrl}`);
        logger.info(`API base URL: ${config.apiBaseUrl}`);
    });

    const shutdown = async (signal) => {
        logger.info(`${signal} received - shutting down gracefully`);
        server.close(async () => {
            await db.close();
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
    start().catch(err => {
        logger.error('Server failed to start', { error: err.message, stack: err.stack });
        process.exit(1);
    });
}

module.exports = app;

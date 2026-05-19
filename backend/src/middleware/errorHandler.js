'use strict';

const logger = require('../utils/logger');

class ApiError extends Error {
    constructor(message, statusCode = 500, code, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

function notFound(req, res, next) {
    res.status(404).json({ error: 'Not found', path: req.originalUrl });
}

function errorHandler(err, req, res, _next) {
    const status = err.statusCode || err.status || 500;
    const payload = {
        error: err.message || 'Internal server error',
        ...(err.code && { code: err.code }),
        ...(err.details && { details: err.details })
    };
    if (status >= 500) {
        logger.error('Unhandled error', {
            error: err.message,
            stack: err.stack,
            path: req.originalUrl,
            method: req.method,
            user: req.user?.id
        });
        if (process.env.NODE_ENV !== 'development') {
            payload.error = 'Internal server error';
        }
    } else {
        logger.debug('Client error', {
            status,
            error: err.message,
            path: req.originalUrl,
            method: req.method
        });
    }
    res.status(status).json(payload);
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { ApiError, notFound, errorHandler, asyncHandler };

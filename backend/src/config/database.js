'use strict';

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../utils/logger');

const poolConfig = config.db.connectionString
    ? {
        connectionString: config.db.connectionString,
        ssl: config.db.ssl,
        max: config.db.max,
        idleTimeoutMillis: config.db.idleTimeoutMillis
    }
    : {
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        ssl: config.db.ssl,
        max: config.db.max,
        idleTimeoutMillis: config.db.idleTimeoutMillis
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
    logger.error('Unexpected database pool error', { error: err.message, stack: err.stack });
});

pool.on('connect', () => {
    logger.debug('New database connection acquired');
});

async function query(text, params = []) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > 1000) {
            logger.warn('Slow query detected', { duration, text: text.substring(0, 100) });
        }
        return result;
    } catch (error) {
        logger.error('Database query error', {
            error: error.message,
            code: error.code,
            text: text.substring(0, 200)
        });
        throw error;
    }
}

async function getClient() {
    const client = await pool.connect();
    const originalRelease = client.release;
    const timeout = setTimeout(() => {
        logger.error('Database client held for >5s - possible leak');
    }, 5000);
    client.release = () => {
        clearTimeout(timeout);
        client.release = originalRelease;
        return originalRelease.apply(client);
    };
    return client;
}

async function transaction(callback) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function healthCheck() {
    try {
        const result = await pool.query('SELECT NOW() AS now');
        return { healthy: true, timestamp: result.rows[0].now };
    } catch (error) {
        return { healthy: false, error: error.message };
    }
}

async function close() {
    await pool.end();
}

module.exports = { pool, query, getClient, transaction, healthCheck, close };

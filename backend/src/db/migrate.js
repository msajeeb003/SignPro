#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../utils/logger');

async function run() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    logger.info('Applying database schema...');
    try {
        await db.query(sql);
        logger.info('Schema applied successfully');
    } catch (error) {
        logger.error('Migration failed', { error: error.message });
        process.exit(1);
    } finally {
        await db.close();
    }
}

run();

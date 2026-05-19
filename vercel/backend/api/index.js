/**
 * Vercel Serverless Function Entry Point
 *
 * Wraps the SignPro Express app so it can run as a single Vercel function.
 * The Express app is imported from the canonical `backend/src/server.js`
 * via a relative path so we don't duplicate routing code.
 *
 * Notes for serverless mode:
 *  - The function has an ephemeral filesystem - uploads must go to Vercel Blob.
 *    See ./storage-adapter.js for the storage shim.
 *  - Database connections are created per cold-start; the pg Pool is reused
 *    across warm invocations.
 *  - maxDuration is set in vercel.json (60s for Pro/Enterprise, 10s on Hobby).
 *  - We override the upload service to use Vercel Blob instead of local fs.
 */

'use strict';

process.env.UPLOAD_DIR = '/tmp/signpro-uploads';

require('dotenv').config();

const fs = require('fs');
if (!fs.existsSync('/tmp/signpro-uploads')) {
    fs.mkdirSync('/tmp/signpro-uploads', { recursive: true });
}

const path = require('path');
const appPath = path.resolve(__dirname, '../../../backend/src/server.js');

let app;
try {
    app = require(appPath);
} catch (error) {
    console.error('Failed to load Express app from', appPath, error);
    throw error;
}

if (process.env.VERCEL_BLOB_ENABLED === 'true' || process.env.BLOB_READ_WRITE_TOKEN) {
    try {
        require('../storage-adapter').install();
        console.log('[vercel] Blob storage adapter installed');
    } catch (error) {
        console.warn('[vercel] Blob adapter not installed:', error.message);
    }
}

module.exports = (req, res) => app(req, res);

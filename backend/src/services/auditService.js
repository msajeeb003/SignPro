'use strict';

const db = require('../config/database');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');

async function getLatestChainHash() {
    const result = await db.query(
        'SELECT chain_hash FROM audit_trails ORDER BY created_at DESC LIMIT 1'
    );
    return result.rows[0]?.chain_hash || '';
}

async function record(event, options = {}) {
    try {
        const previousHash = await getLatestChainHash();
        const payload = JSON.stringify({
            actor: event.actor_user_id || null,
            action: event.action,
            entity_type: event.entity_type,
            entity_id: event.entity_id || null,
            description: event.description,
            timestamp: new Date().toISOString()
        });
        const chainHash = cryptoUtils.sha256(previousHash + payload);

        const result = await (options.client || db).query(
            `INSERT INTO audit_trails (
                actor_user_id, actor_email, action, entity_type, entity_id,
                document_id, signature_request_id, description,
                ip_address, user_agent, request_id, previous_state, new_state,
                metadata, chain_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING id, created_at`,
            [
                event.actor_user_id || null,
                event.actor_email || null,
                event.action,
                event.entity_type,
                event.entity_id || null,
                event.document_id || null,
                event.signature_request_id || null,
                event.description,
                event.ip_address || null,
                event.user_agent || null,
                event.request_id || null,
                event.previous_state ? JSON.stringify(event.previous_state) : null,
                event.new_state ? JSON.stringify(event.new_state) : null,
                event.metadata ? JSON.stringify(event.metadata) : '{}',
                chainHash
            ]
        );
        return result.rows[0];
    } catch (error) {
        logger.error('Failed to record audit event', {
            error: error.message,
            action: event.action,
            entity_type: event.entity_type
        });
    }
}

async function getDocumentHistory(documentId) {
    const result = await db.query(
        `SELECT id, actor_user_id, actor_email, action, description,
                ip_address, user_agent, metadata, chain_hash, created_at
         FROM audit_trails
         WHERE document_id = $1
         ORDER BY created_at ASC`,
        [documentId]
    );
    return result.rows;
}

async function getUserActivity(userId, limit = 50) {
    const result = await db.query(
        `SELECT id, action, entity_type, entity_id, description,
                ip_address, created_at
         FROM audit_trails
         WHERE actor_user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
    );
    return result.rows;
}

module.exports = { record, getDocumentHistory, getUserActivity };

'use strict';

const express = require('express');
const auth = require('../middleware/auth');
const db = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/', auth.requireAuth, asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const channel = req.query.channel;

    const params = [req.user.id, limit, offset];
    let where = 'user_id = $1';
    if (channel) {
        params.push(channel);
        where += ` AND channel = $${params.length}`;
    }
    const result = await db.query(
        `SELECT id, signature_request_id, document_id, channel, status,
                recipient, subject, body_preview, sent_at, read_at, error_message,
                created_at
         FROM notification_logs
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        params
    );
    res.json({ notifications: result.rows });
}));

router.post('/:id/read', auth.requireAuth, asyncHandler(async (req, res) => {
    const result = await db.query(
        `UPDATE notification_logs SET read_at = NOW(), status = 'read'
         WHERE id = $1 AND user_id = $2 AND read_at IS NULL
         RETURNING id`,
        [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
}));

router.get('/unread-count', auth.requireAuth, asyncHandler(async (req, res) => {
    const result = await db.query(
        `SELECT COUNT(*)::INT AS count
         FROM notification_logs WHERE user_id = $1 AND read_at IS NULL`,
        [req.user.id]
    );
    res.json({ count: result.rows[0].count });
}));

module.exports = router;

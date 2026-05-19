'use strict';

const twilio = require('twilio');
const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger');
const { isE164 } = require('../utils/validators');

let twilioClient = null;

function getClient() {
    if (twilioClient) return twilioClient;
    if (!config.twilio.accountSid || !config.twilio.authToken) {
        throw new Error('Twilio credentials not configured');
    }
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    return twilioClient;
}

function buildSignatureSms({ signerName, senderName, documentTitle, signingUrl }) {
    const shortTitle = documentTitle.length > 40 ? documentTitle.slice(0, 37) + '...' : documentTitle;
    return `Hi ${signerName}, ${senderName} requests your signature on "${shortTitle}". Sign here: ${signingUrl}`;
}

async function sendSms({ userId, to, body, signatureRequestId, documentId }) {
    if (!isE164(to)) {
        return { success: false, error: 'Phone number must be E.164 (e.g. +15551234567)' };
    }

    let logId;
    try {
        const logInsert = await db.query(
            `INSERT INTO notification_logs
             (user_id, signature_request_id, document_id, channel, status, recipient, body_preview, provider)
             VALUES ($1, $2, $3, 'sms', 'queued', $4, $5, 'twilio')
             RETURNING id`,
            [userId, signatureRequestId, documentId, to, body.substring(0, 200)]
        );
        logId = logInsert.rows[0].id;

        const client = getClient();
        const messageOptions = {
            body,
            to,
            ...(config.twilio.messagingServiceSid
                ? { messagingServiceSid: config.twilio.messagingServiceSid }
                : { from: config.twilio.phoneNumber }),
            statusCallback: `${config.apiBaseUrl}/api/webhooks/twilio/status`
        };
        const message = await client.messages.create(messageOptions);

        await db.query(
            `UPDATE notification_logs
             SET status = 'sent', sent_at = NOW(), provider_message_id = $2,
                 provider_response = $3
             WHERE id = $1`,
            [logId, message.sid, JSON.stringify({
                status: message.status,
                num_segments: message.numSegments,
                price: message.price
            })]
        );
        return { success: true, sid: message.sid, logId };
    } catch (error) {
        logger.error('SMS send failed', { error: error.message, to, signatureRequestId });
        if (logId) {
            await db.query(
                `UPDATE notification_logs
                 SET status = 'failed', failed_at = NOW(), error_message = $2
                 WHERE id = $1`,
                [logId, error.message]
            );
        }
        return { success: false, error: error.message, logId };
    }
}

async function sendSignatureRequestSms({ signatureRequest, document, sender }) {
    if (!signatureRequest.signer_phone) {
        return { success: false, error: 'No phone number on signature request' };
    }
    const signingUrl = `${config.frontendUrl}/sign/${signatureRequest.access_token}`;
    const body = buildSignatureSms({
        signerName: signatureRequest.signer_name,
        senderName: sender.full_name,
        documentTitle: document.title,
        signingUrl
    });
    return sendSms({
        userId: sender.id,
        to: signatureRequest.signer_phone,
        body,
        signatureRequestId: signatureRequest.id,
        documentId: document.id
    });
}

async function handleStatusCallback(payload) {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = payload;
    if (!MessageSid) return;
    const statusMap = {
        delivered: 'delivered',
        sent: 'sent',
        failed: 'failed',
        undelivered: 'failed',
        queued: 'queued'
    };
    const newStatus = statusMap[String(MessageStatus).toLowerCase()] || 'sent';
    await db.query(
        `UPDATE notification_logs
         SET status = $2,
             ${newStatus === 'delivered' ? 'delivered_at = NOW(),' : ''}
             ${newStatus === 'failed' ? 'failed_at = NOW(),' : ''}
             error_message = COALESCE($3, error_message),
             provider_response = COALESCE(provider_response, '{}'::jsonb) || $4::jsonb
         WHERE provider_message_id = $1`,
        [
            MessageSid,
            newStatus,
            ErrorMessage || (ErrorCode ? `Twilio error ${ErrorCode}` : null),
            JSON.stringify({ MessageStatus, ErrorCode })
        ]
    );
}

module.exports = { sendSms, sendSignatureRequestSms, handleStatusCallback };

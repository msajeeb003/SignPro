'use strict';

const nodemailer = require('nodemailer');
const db = require('../config/database');
const config = require('../config');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');

async function getUserSmtpConfig(userId) {
    const result = await db.query(
        `SELECT id, host, port, secure, username, password_encrypted,
                from_name, from_address, reply_to, is_verified
         FROM smtp_configurations
         WHERE user_id = $1 AND is_default = TRUE
         LIMIT 1`,
        [userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        id: row.id,
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        password: cryptoUtils.decrypt(row.password_encrypted),
        fromName: row.from_name,
        fromAddress: row.from_address,
        replyTo: row.reply_to,
        isVerified: row.is_verified
    };
}

async function buildTransporter(userId) {
    const userConfig = userId ? await getUserSmtpConfig(userId) : null;
    if (userConfig) {
        return {
            transporter: nodemailer.createTransport({
                host: userConfig.host,
                port: userConfig.port,
                secure: userConfig.secure,
                auth: { user: userConfig.username, pass: userConfig.password },
                connectionTimeout: 10000,
                socketTimeout: 30000
            }),
            from: `"${userConfig.fromName}" <${userConfig.fromAddress}>`,
            replyTo: userConfig.replyTo,
            configId: userConfig.id
        };
    }
    return {
        transporter: nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            auth: { user: config.smtp.user, pass: config.smtp.pass }
        }),
        from: `"${config.smtp.fromName}" <${config.smtp.fromAddress}>`,
        replyTo: null,
        configId: null
    };
}

async function verifySmtp({ host, port, secure, username, password }) {
    const transporter = nodemailer.createTransport({
        host, port, secure,
        auth: { user: username, pass: password },
        connectionTimeout: 10000
    });
    try {
        await transporter.verify();
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message };
    } finally {
        transporter.close();
    }
}

function buildSignatureRequestEmail({ signerName, senderName, documentTitle, signingUrl, message, expiresAt }) {
    const subject = `${senderName} requests your signature on "${documentTitle}"`;
    const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="color-scheme" content="light dark"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f4f6f8;margin:0;padding:24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
    <tr><td style="padding:28px 32px 0;">
      <h1 style="margin:0 0 8px;font-size:20px;color:#111827;">Signature requested</h1>
      <p style="margin:0;color:#6b7280;font-size:14px;">SignPro - Legal Document Signing</p>
    </td></tr>
    <tr><td style="padding:20px 32px;">
      <p style="margin:0 0 14px;color:#111827;">Hi ${escapeHtml(signerName)},</p>
      <p style="margin:0 0 14px;color:#374151;line-height:1.55;">
        <strong>${escapeHtml(senderName)}</strong> has requested your signature on
        <strong>${escapeHtml(documentTitle)}</strong>.
      </p>
      ${message ? `<blockquote style="margin:14px 0;padding:12px 16px;background:#f9fafb;border-left:3px solid #2563eb;color:#374151;border-radius:0 4px 4px 0;">${escapeHtml(message)}</blockquote>` : ''}
      <div style="text-align:center;margin:24px 0;">
        <a href="${signingUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Review & Sign Document</a>
      </div>
      <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
        This request expires on <strong>${new Date(expiresAt).toLocaleString()}</strong>.
        If the button doesn't work, copy and paste this URL:
      </p>
      <p style="margin:8px 0 0;color:#2563eb;font-size:12px;word-break:break-all;">${signingUrl}</p>
    </td></tr>
    <tr><td style="padding:16px 32px 28px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">
      Do not share this link. It is unique to you and grants legal access to sign this document.
    </td></tr>
  </table>
</body></html>`;
    const text =
        `Hi ${signerName},\n\n${senderName} has requested your signature on "${documentTitle}".\n\n` +
        (message ? `Message: ${message}\n\n` : '') +
        `Sign here: ${signingUrl}\n\nThis request expires on ${new Date(expiresAt).toLocaleString()}.`;
    return { subject, html, text };
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function sendEmail({ userId, to, subject, html, text, signatureRequestId, documentId }) {
    let logId;
    try {
        const logInsert = await db.query(
            `INSERT INTO notification_logs
             (user_id, signature_request_id, document_id, channel, status, recipient, subject, body_preview, provider)
             VALUES ($1, $2, $3, 'email', 'queued', $4, $5, $6, 'smtp')
             RETURNING id`,
            [userId, signatureRequestId, documentId, to, subject, (text || '').substring(0, 200)]
        );
        logId = logInsert.rows[0].id;

        const { transporter, from, replyTo } = await buildTransporter(userId);
        const info = await transporter.sendMail({
            from, to, subject, html, text,
            ...(replyTo && { replyTo })
        });
        transporter.close();

        await db.query(
            `UPDATE notification_logs
             SET status = 'sent', sent_at = NOW(), provider_message_id = $2, provider_response = $3
             WHERE id = $1`,
            [logId, info.messageId, JSON.stringify({ response: info.response, accepted: info.accepted })]
        );
        return { success: true, messageId: info.messageId, logId };
    } catch (error) {
        logger.error('Email send failed', { error: error.message, to, signatureRequestId });
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

async function sendSignatureRequestEmail({ signatureRequest, document, sender }) {
    const signingUrl = `${config.frontendUrl}/sign/${signatureRequest.access_token}`;
    const { subject, html, text } = buildSignatureRequestEmail({
        signerName: signatureRequest.signer_name,
        senderName: sender.full_name,
        documentTitle: document.title,
        signingUrl,
        message: signatureRequest.message,
        expiresAt: signatureRequest.expires_at
    });
    return sendEmail({
        userId: sender.id,
        to: signatureRequest.signer_email,
        subject, html, text,
        signatureRequestId: signatureRequest.id,
        documentId: document.id
    });
}

module.exports = {
    verifySmtp,
    sendEmail,
    sendSignatureRequestEmail,
    getUserSmtpConfig
};

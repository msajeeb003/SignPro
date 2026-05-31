'use strict';

const fs = require('fs').promises;
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const db = require('../config/database');
const config = require('../config');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');
const auditService = require('./auditService');
const emailService = require('./emailService');
const smsService = require('./smsService');
const { isEmail, isE164 } = require('../utils/validators');

const SIGNED_DOCS_DIR = path.join(config.upload.dir, 'signed');

async function ensureSignedDir() {
    await fs.mkdir(SIGNED_DOCS_DIR, { recursive: true });
}

/**
 * Creates one or more signature requests for a document with their coordinate fields.
 * Body shape:
 *   {
 *     documentId,
 *     recipients: [
 *       {
 *         email, name, phone, signing_order, message, expires_in_days,
 *         fields: [
 *           { page_number, x, y, width, height, page_width, page_height,
 *             field_type, label, is_required, placeholder, sort_order }
 *         ]
 *       }
 *     ],
 *     notify: { email: true, sms: false }
 *   }
 */
async function createSignatureRequests({ documentId, sender, recipients, notify, requestContext }) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
        throw makeError('At least one recipient is required', 400, 'NO_RECIPIENTS');
    }

    const docResult = await db.query(
        'SELECT * FROM documents WHERE id = $1 AND owner_id = $2',
        [documentId, sender.id]
    );
    if (docResult.rows.length === 0) {
        throw makeError('Document not found or access denied', 404, 'NOT_FOUND');
    }
    const document = docResult.rows[0];
    if (!['ready', 'sent', 'partially_signed'].includes(document.status)) {
        throw makeError(
            `Document is not in a sendable state (current: ${document.status})`,
            409,
            'INVALID_STATE'
        );
    }

    const created = await db.transaction(async (client) => {
        const out = [];
        for (const recipient of recipients) {
            if (!isEmail(recipient.email)) {
                throw makeError(`Invalid email: ${recipient.email}`, 400, 'INVALID_EMAIL');
            }
            if (recipient.phone && !isE164(recipient.phone)) {
                throw makeError(
                    `Phone must be E.164 (e.g. +15551234567): ${recipient.phone}`,
                    400,
                    'INVALID_PHONE'
                );
            }
            if (!Array.isArray(recipient.fields) || recipient.fields.length === 0) {
                throw makeError(
                    `Recipient ${recipient.email} has no signature fields`,
                    400,
                    'NO_FIELDS'
                );
            }

            const accessToken = cryptoUtils.generateToken(32);
            const verificationCode = cryptoUtils.generateNumericCode(6);
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + (recipient.expires_in_days || 14));

            const signerUserLookup = await client.query(
                'SELECT id FROM users WHERE email = $1',
                [recipient.email.toLowerCase()]
            );
            const signerUserId = signerUserLookup.rows[0]?.id || null;
            const isSelf = recipient.auto_sign === true && signerUserId === sender.id;

            const sigInsert = await client.query(
                `INSERT INTO signature_requests (
                    document_id, sender_id, signer_user_id, signer_email, signer_name,
                    signer_phone, signing_order, status, access_token,
                    access_token_expires_at, message, verification_code, expires_at,
                    sent_at, first_viewed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING *`,
                [
                    documentId,
                    sender.id,
                    signerUserId,
                    recipient.email.toLowerCase(),
                    recipient.name,
                    recipient.phone || null,
                    recipient.signing_order || 1,
                    isSelf ? 'pending' : 'pending',
                    accessToken,
                    expiresAt,
                    recipient.message || null,
                    verificationCode,
                    expiresAt,
                    isSelf ? new Date() : null,
                    isSelf ? new Date() : null
                ]
            );
            const sigRequest = sigInsert.rows[0];
            const insertedFields = [];

            for (let i = 0; i < recipient.fields.length; i++) {
                const field = recipient.fields[i];
                validateField(field, document);
                const signedField = isSelf
                    ? recipient.signed_fields?.find(sf => sf.sort_order === (field.sort_order ?? i))
                    : null;
                const result = await client.query(
                    `INSERT INTO signature_coordinates (
                        signature_request_id, document_id, field_type, page_number,
                        x_position, y_position, width, height,
                        page_width, page_height,
                        is_required, label, placeholder, sort_order,
                        signed_value, signed_image_data, signed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                    RETURNING *`,
                    [
                        sigRequest.id,
                        documentId,
                        field.field_type || 'signature',
                        field.page_number,
                        field.x,
                        field.y,
                        field.width,
                        field.height,
                        field.page_width,
                        field.page_height,
                        field.is_required !== false,
                        field.label || null,
                        field.placeholder || null,
                        field.sort_order ?? i,
                        signedField?.value || null,
                        signedField?.image_data || null,
                        isSelf && signedField ? new Date() : null
                    ]
                );
                insertedFields.push(result.rows[0]);
            }

            await auditService.record({
                actor_user_id: sender.id,
                actor_email: sender.email,
                action: 'signature_request_created',
                entity_type: 'signature_request',
                entity_id: sigRequest.id,
                document_id: documentId,
                signature_request_id: sigRequest.id,
                description: `Signature request created for ${recipient.email}${isSelf ? ' (self)' : ''}`,
                ip_address: requestContext?.ip,
                user_agent: requestContext?.userAgent
            }, { client });

            if (isSelf) {
                await completeSelfSign({
                    client,
                    sigRequest,
                    document,
                    sender,
                    fields: insertedFields,
                    requestContext
                });
                sigRequest._autoSigned = true;
            }

            out.push(sigRequest);
        }

        await client.query(
            `UPDATE documents SET status = 'sent' WHERE id = $1 AND status = 'ready'`,
            [documentId]
        );
        return out;
    });

    const deliveryResults = [];
    for (const sr of created) {
        const result = { signature_request_id: sr.id, email: null, sms: null, autoSigned: !!sr._autoSigned };
        if (sr._autoSigned) {
            deliveryResults.push(result);
            continue;
        }
        if (notify?.email !== false) {
            result.email = await emailService.sendSignatureRequestEmail({
                signatureRequest: sr,
                document,
                sender
            });
        }
        if (notify?.sms === true && sr.signer_phone) {
            result.sms = await smsService.sendSignatureRequestSms({
                signatureRequest: sr,
                document,
                sender
            });
        }
        if (sr.signer_user_id) {
            await db.query(
                `INSERT INTO notification_logs
                 (user_id, signature_request_id, document_id, channel, status, recipient, subject)
                 VALUES ($1, $2, $3, 'extension', 'queued', $4, $5)`,
                [sr.signer_user_id, sr.id, documentId, sr.signer_email,
                 `New signature request: ${document.title}`]
            );
        }
        await db.query(
            `UPDATE signature_requests SET sent_at = NOW() WHERE id = $1 AND sent_at IS NULL`,
            [sr.id]
        );
        deliveryResults.push(result);
    }

    return { signatureRequests: created, delivery: deliveryResults };
}

function validateField(field, document) {
    if (!field.page_number || field.page_number < 1) {
        throw makeError('field.page_number must be >= 1', 400, 'INVALID_FIELD');
    }
    if (document.page_count && field.page_number > document.page_count) {
        throw makeError(
            `field.page_number ${field.page_number} exceeds document pages (${document.page_count})`,
            400,
            'INVALID_FIELD'
        );
    }
    for (const k of ['x', 'y', 'width', 'height', 'page_width', 'page_height']) {
        if (typeof field[k] !== 'number' || !Number.isFinite(field[k]) || field[k] < 0) {
            throw makeError(`field.${k} must be a non-negative number`, 400, 'INVALID_FIELD');
        }
    }
    if (field.x + field.width > field.page_width + 0.01 ||
        field.y + field.height > field.page_height + 0.01) {
        throw makeError(
            `Field extends beyond page boundaries on page ${field.page_number}`,
            400, 'FIELD_OUT_OF_BOUNDS'
        );
    }
}

/**
 * Loads a signature request by access token for the signing UI.
 * Returns the signature request, document, and field coordinates,
 * marking the request as "viewed" if not already.
 */
async function loadSigningSession(accessToken, requestContext) {
    const result = await db.query(
        `SELECT sr.*, d.id AS doc_id, d.title AS doc_title, d.description AS doc_description,
                d.document_type, d.page_count, d.page_dimensions,
                d.status AS doc_status, d.expires_at AS doc_expires_at,
                u.full_name AS sender_name, u.email AS sender_email
         FROM signature_requests sr
         JOIN documents d ON d.id = sr.document_id
         JOIN users u ON u.id = sr.sender_id
         WHERE sr.access_token = $1`,
        [accessToken]
    );
    if (result.rows.length === 0) {
        throw makeError('Invalid signing link', 404, 'INVALID_TOKEN');
    }
    const sr = result.rows[0];

    if (new Date(sr.expires_at) < new Date()) {
        await db.query(
            `UPDATE signature_requests SET status = 'expired' WHERE id = $1 AND status NOT IN ('signed', 'declined', 'cancelled')`,
            [sr.id]
        );
        throw makeError('Signing link has expired', 410, 'EXPIRED');
    }
    if (sr.status === 'signed') {
        throw makeError('This document has already been signed', 409, 'ALREADY_SIGNED');
    }
    if (sr.status === 'declined') {
        throw makeError('This signing request was declined', 409, 'DECLINED');
    }
    if (sr.status === 'cancelled') {
        throw makeError('This signing request was cancelled', 410, 'CANCELLED');
    }

    if (sr.status === 'pending') {
        await db.query(
            `UPDATE signature_requests
             SET status = 'viewed', first_viewed_at = COALESCE(first_viewed_at, NOW())
             WHERE id = $1`,
            [sr.id]
        );
        await auditService.record({
            actor_email: sr.signer_email,
            action: 'document_viewed',
            entity_type: 'signature_request',
            entity_id: sr.id,
            document_id: sr.document_id,
            signature_request_id: sr.id,
            description: `Document viewed by ${sr.signer_email}`,
            ip_address: requestContext?.ip,
            user_agent: requestContext?.userAgent
        });
    }

    const fieldsResult = await db.query(
        `SELECT id, field_type, page_number, x_position, y_position,
                width, height, page_width, page_height,
                is_required, label, placeholder, signed_value, signed_at, sort_order
         FROM signature_coordinates
         WHERE signature_request_id = $1
         ORDER BY page_number, sort_order, y_position DESC`,
        [sr.id]
    );

    return {
        signatureRequest: {
            id: sr.id,
            signer_name: sr.signer_name,
            signer_email: sr.signer_email,
            status: sr.status,
            message: sr.message,
            expires_at: sr.expires_at
        },
        document: {
            id: sr.doc_id,
            title: sr.doc_title,
            description: sr.doc_description,
            document_type: sr.document_type,
            page_count: sr.page_count,
            page_dimensions: sr.page_dimensions
        },
        sender: {
            name: sr.sender_name,
            email: sr.sender_email
        },
        fields: fieldsResult.rows
    };
}

/**
 * Completes a signature request - writes the signed values into the
 * coordinate records, embeds them into the PDF, generates an HMAC over
 * the final document hash, and records signature_evidence + audit trail.
 *
 * fieldValues: [{ field_id, value, image_data? }]
 */
async function completeSignature({ accessToken, fieldValues, consent, verificationCode, requestContext }) {
    if (!consent || consent.accepted !== true) {
        throw makeError('Electronic signature consent required', 400, 'CONSENT_REQUIRED');
    }

    const sigResult = await db.query(
        `SELECT sr.*, d.storage_path, d.document_type, d.title AS doc_title, d.id AS doc_id
         FROM signature_requests sr
         JOIN documents d ON d.id = sr.document_id
         WHERE sr.access_token = $1`,
        [accessToken]
    );
    if (sigResult.rows.length === 0) throw makeError('Invalid token', 404, 'INVALID_TOKEN');
    const sr = sigResult.rows[0];

    if (sr.status === 'signed') throw makeError('Already signed', 409, 'ALREADY_SIGNED');
    if (new Date(sr.expires_at) < new Date()) throw makeError('Expired', 410, 'EXPIRED');

    if (sr.verification_code && verificationCode) {
        if (!cryptoUtils.constantTimeEqual(sr.verification_code, verificationCode)) {
            await db.query(
                `UPDATE signature_requests
                 SET verification_attempts = verification_attempts + 1
                 WHERE id = $1`,
                [sr.id]
            );
            await auditService.record({
                actor_email: sr.signer_email,
                action: 'verification_failed',
                entity_type: 'signature_request',
                entity_id: sr.id,
                signature_request_id: sr.id,
                document_id: sr.doc_id,
                description: 'Verification code mismatch',
                ip_address: requestContext?.ip
            });
            throw makeError('Verification code incorrect', 401, 'BAD_CODE');
        }
    }

    const fieldsResult = await db.query(
        `SELECT * FROM signature_coordinates WHERE signature_request_id = $1`,
        [sr.id]
    );
    const fields = fieldsResult.rows;
    const valueMap = new Map(fieldValues.map(v => [v.field_id, v]));
    for (const field of fields) {
        if (field.is_required && !valueMap.has(field.id)) {
            throw makeError(
                `Missing value for required field: ${field.label || field.field_type} (page ${field.page_number})`,
                400, 'MISSING_REQUIRED_FIELD'
            );
        }
    }

    await ensureSignedDir();

    const signedFilePath = path.join(
        SIGNED_DOCS_DIR,
        `${sr.id}_signed_${Date.now()}.pdf`
    );

    const evidenceData = await db.transaction(async (client) => {
        const sourcePath = sr.document_type === 'docx'
            ? `${sr.storage_path}.pdf`
            : sr.storage_path;

        const signedHash = await embedSignaturesIntoPdf({
            sourcePath,
            outputPath: signedFilePath,
            fields,
            valueMap,
            signerName: sr.signer_name,
            signedAt: new Date()
        });

        for (const field of fields) {
            const value = valueMap.get(field.id);
            if (!value) continue;
            await client.query(
                `UPDATE signature_coordinates
                 SET signed_value = $2, signed_image_data = $3, signed_at = NOW()
                 WHERE id = $1`,
                [field.id, value.value || null, value.image_data || null]
            );
        }

        const signatureHmac = cryptoUtils.hmac(
            `${sr.id}|${sr.doc_id}|${signedHash}|${sr.signer_email}`
        );

        const evidenceInsert = await client.query(
            `INSERT INTO signature_evidence (
                signature_request_id, document_id, signer_id,
                signed_document_hash, signature_hmac, signed_pdf_path,
                consent_text, consent_accepted_at,
                ip_address, user_agent, geolocation,
                verification_method, verification_value
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *`,
            [
                sr.id,
                sr.doc_id,
                sr.signer_user_id,
                signedHash,
                signatureHmac,
                signedFilePath,
                consent.text || 'I agree to use electronic signatures and that they are legally binding.',
                consent.accepted_at || new Date(),
                requestContext?.ip || null,
                requestContext?.userAgent || null,
                consent.geolocation ? JSON.stringify(consent.geolocation) : null,
                verificationCode ? 'access_token+otp' : 'access_token',
                verificationCode ? '***' : null
            ]
        );

        await client.query(
            `UPDATE signature_requests
             SET status = 'signed', signed_at = NOW(),
                 sign_ip_address = $2, sign_user_agent = $3, sign_geolocation = $4
             WHERE id = $1`,
            [
                sr.id,
                requestContext?.ip || null,
                requestContext?.userAgent || null,
                consent.geolocation ? JSON.stringify(consent.geolocation) : null
            ]
        );

        const remaining = await client.query(
            `SELECT COUNT(*) FILTER (WHERE status NOT IN ('signed', 'declined', 'cancelled')) AS pending,
                    COUNT(*) AS total
             FROM signature_requests WHERE document_id = $1`,
            [sr.doc_id]
        );
        const { pending, total } = remaining.rows[0];
        if (parseInt(pending, 10) === 0) {
            await client.query(
                `UPDATE documents SET status = 'completed', completed_at = NOW() WHERE id = $1`,
                [sr.doc_id]
            );
        } else if (parseInt(pending, 10) < parseInt(total, 10)) {
            await client.query(
                `UPDATE documents SET status = 'partially_signed' WHERE id = $1 AND status = 'sent'`,
                [sr.doc_id]
            );
        }

        await auditService.record({
            actor_user_id: sr.signer_user_id,
            actor_email: sr.signer_email,
            action: 'document_signed',
            entity_type: 'signature_request',
            entity_id: sr.id,
            document_id: sr.doc_id,
            signature_request_id: sr.id,
            description: `Document signed by ${sr.signer_email}`,
            ip_address: requestContext?.ip,
            user_agent: requestContext?.userAgent,
            metadata: { signed_hash: signedHash }
        }, { client });

        return {
            evidence: evidenceInsert.rows[0],
            signedHash,
            signatureHmac
        };
    });

    if (sr.signer_user_id) {
        await db.query(
            `INSERT INTO notification_logs
             (user_id, signature_request_id, document_id, channel, status, recipient, subject)
             VALUES ($1, $2, $3, 'extension', 'queued', $4, $5)`,
            [sr.signer_user_id, sr.id, sr.doc_id, sr.signer_email,
             `Signature complete: ${sr.doc_title}`]
        );
    }
    await db.query(
        `INSERT INTO notification_logs
         (user_id, signature_request_id, document_id, channel, status, recipient, subject)
         VALUES ($1, $2, $3, 'extension', 'queued', $4, $5)`,
        [sr.sender_id, sr.id, sr.doc_id, sr.signer_email,
         `${sr.signer_name} signed: ${sr.doc_title}`]
    );

    return {
        success: true,
        signedAt: new Date().toISOString(),
        documentHash: evidenceData.signedHash,
        verification: {
            hmac: evidenceData.signatureHmac,
            evidenceId: evidenceData.evidence.id
        }
    };
}

/**
 * Embeds signature values onto each page at the recorded coordinates.
 * Coordinates from the frontend are top-left origin (web convention);
 * pdf-lib uses bottom-left, so we convert: pdfY = pageHeight - y - height.
 */
async function embedSignaturesIntoPdf({ sourcePath, outputPath, fields, valueMap, signerName, signedAt }) {
    const sourceBytes = await fs.readFile(sourcePath);
    const pdfDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();

    for (const field of fields) {
        const value = valueMap.get(field.id);
        if (!value && field.is_required) continue;
        if (!value) continue;

        const page = pages[field.page_number - 1];
        if (!page) continue;
        const { width: pageWidth, height: pageHeight } = page.getSize();
        const scaleX = pageWidth / Number(field.page_width);
        const scaleY = pageHeight / Number(field.page_height);
        const x = Number(field.x_position) * scaleX;
        const w = Number(field.width) * scaleX;
        const h = Number(field.height) * scaleY;
        const yWebTop = Number(field.y_position) * scaleY;
        const y = pageHeight - yWebTop - h;

        if (field.field_type === 'signature' || field.field_type === 'initial') {
            if (value.image_data && /^data:image\/(png|jpe?g);base64,/.test(value.image_data)) {
                const mimeMatch = value.image_data.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
                const imgBytes = Buffer.from(mimeMatch[2], 'base64');
                const img = mimeMatch[1] === 'png'
                    ? await pdfDoc.embedPng(imgBytes)
                    : await pdfDoc.embedJpg(imgBytes);
                const aspect = img.width / img.height;
                let drawW = w, drawH = h;
                if (w / h > aspect) drawW = h * aspect;
                else drawH = w / aspect;
                page.drawImage(img, {
                    x: x + (w - drawW) / 2,
                    y: y + (h - drawH) / 2,
                    width: drawW,
                    height: drawH
                });
            } else {
                const text = value.value || signerName;
                const fontSize = Math.min(h * 0.55, 24);
                const textWidth = fontItalic.widthOfTextAtSize(text, fontSize);
                page.drawText(text, {
                    x: x + Math.max(2, (w - textWidth) / 2),
                    y: y + h * 0.25,
                    size: fontSize,
                    font: fontItalic,
                    color: rgb(0.05, 0.1, 0.4)
                });
            }
            page.drawText(`Signed by ${signerName} on ${signedAt.toLocaleString()}`, {
                x, y: y - 9,
                size: 6,
                font,
                color: rgb(0.4, 0.4, 0.4)
            });
        } else if (field.field_type === 'date') {
            const text = value.value || signedAt.toLocaleDateString();
            page.drawText(text, {
                x: x + 4, y: y + h / 2 - 5,
                size: Math.min(h * 0.6, 12),
                font, color: rgb(0, 0, 0)
            });
        } else if (field.field_type === 'checkbox') {
            const checked = value.value === 'true' || value.value === true;
            page.drawRectangle({
                x, y, width: w, height: h,
                borderColor: rgb(0, 0, 0), borderWidth: 1
            });
            if (checked) {
                page.drawText('X', {
                    x: x + w * 0.2, y: y + h * 0.2,
                    size: Math.min(h * 0.8, 16),
                    font: fontBold, color: rgb(0, 0, 0)
                });
            }
        } else {
            const text = String(value.value || '');
            page.drawText(text, {
                x: x + 4, y: y + h / 2 - 5,
                size: Math.min(h * 0.55, 12),
                font, color: rgb(0, 0, 0),
                maxWidth: w - 8
            });
        }
    }

    pdfDoc.setModificationDate(signedAt);
    const signedBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, signedBytes);
    return cryptoUtils.sha256(signedBytes);
}

/**
 * Inline self-signing: called within createSignatureRequests when a recipient
 * has auto_sign=true and the signer matches the authenticated sender. Embeds
 * the provided signatures, records evidence, and marks the request signed -
 * no email or token-based signing session needed.
 */
async function completeSelfSign({ client, sigRequest, document, sender, fields, requestContext }) {
    await ensureSignedDir();

    const signedFilePath = path.join(
        SIGNED_DOCS_DIR,
        `${sigRequest.id}_selfsign_${Date.now()}.pdf`
    );

    const sourcePath = document.document_type === 'docx'
        ? `${document.storage_path}.pdf`
        : document.storage_path;

    const valueMap = new Map();
    for (const f of fields) {
        valueMap.set(f.id, {
            field_id: f.id,
            value: f.signed_value,
            image_data: f.signed_image_data
        });
    }

    const signedHash = await embedSignaturesIntoPdf({
        sourcePath,
        outputPath: signedFilePath,
        fields,
        valueMap,
        signerName: sigRequest.signer_name,
        signedAt: new Date()
    });

    const signatureHmac = cryptoUtils.hmac(
        `${sigRequest.id}|${document.id}|${signedHash}|${sigRequest.signer_email}`
    );

    await client.query(
        `INSERT INTO signature_evidence (
            signature_request_id, document_id, signer_id,
            signed_document_hash, signature_hmac, signed_pdf_path,
            consent_text, consent_accepted_at,
            ip_address, user_agent, verification_method
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
            sigRequest.id,
            document.id,
            sender.id,
            signedHash,
            signatureHmac,
            signedFilePath,
            'I authored this document and consent to use my electronic signature as the legally binding signature.',
            new Date(),
            requestContext?.ip || null,
            requestContext?.userAgent || null,
            'authenticated_session'
        ]
    );

    await client.query(
        `UPDATE signature_requests
         SET status = 'signed', signed_at = NOW(),
             sign_ip_address = $2, sign_user_agent = $3
         WHERE id = $1`,
        [sigRequest.id, requestContext?.ip || null, requestContext?.userAgent || null]
    );

    await auditService.record({
        actor_user_id: sender.id,
        actor_email: sender.email,
        action: 'document_signed',
        entity_type: 'signature_request',
        entity_id: sigRequest.id,
        document_id: document.id,
        signature_request_id: sigRequest.id,
        description: `Document self-signed by ${sender.email} in editor`,
        ip_address: requestContext?.ip,
        user_agent: requestContext?.userAgent,
        metadata: { signed_hash: signedHash, method: 'self_sign' }
    }, { client });

    return { signedHash, signatureHmac, signedFilePath };
}

async function declineSignature({ accessToken, reason, requestContext }) {
    const result = await db.query(
        `UPDATE signature_requests
         SET status = 'declined', declined_at = NOW(), decline_reason = $2
         WHERE access_token = $1 AND status NOT IN ('signed', 'declined', 'cancelled')
         RETURNING *`,
        [accessToken, reason || null]
    );
    if (result.rows.length === 0) {
        throw makeError('Cannot decline - request not found or already finalized', 404, 'INVALID_STATE');
    }
    const sr = result.rows[0];
    await auditService.record({
        actor_email: sr.signer_email,
        action: 'document_declined',
        entity_type: 'signature_request',
        entity_id: sr.id,
        document_id: sr.document_id,
        signature_request_id: sr.id,
        description: `Signature declined by ${sr.signer_email}${reason ? `: ${reason}` : ''}`,
        ip_address: requestContext?.ip,
        user_agent: requestContext?.userAgent
    });
    return sr;
}

async function verifySignature({ documentId, hmac }) {
    const result = await db.query(
        `SELECT se.*, sr.signer_email, sr.signer_name, sr.signed_at
         FROM signature_evidence se
         JOIN signature_requests sr ON sr.id = se.signature_request_id
         WHERE se.document_id = $1`,
        [documentId]
    );
    const evidence = result.rows;
    if (evidence.length === 0) return { valid: false, reason: 'No evidence found' };
    if (hmac) {
        const matching = evidence.find(e => cryptoUtils.constantTimeEqual(e.signature_hmac, hmac));
        if (!matching) return { valid: false, reason: 'HMAC mismatch' };
    }
    return {
        valid: true,
        signatures: evidence.map(e => ({
            signer_email: e.signer_email,
            signer_name: e.signer_name,
            signed_at: e.signed_at,
            document_hash: e.signed_document_hash,
            ip_address: e.ip_address
        }))
    };
}

function makeError(message, statusCode, code) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

module.exports = {
    createSignatureRequests,
    loadSigningSession,
    completeSignature,
    declineSignature,
    verifySignature,
    ensureSignedDir
};

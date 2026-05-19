'use strict';

const crypto = require('crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';

function deriveKey(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(plainText, secret = config.security.signatureHmacSecret) {
    if (plainText == null) return null;
    const iv = crypto.randomBytes(12);
    const key = deriveKey(secret);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decrypt(cipherText, secret = config.security.signatureHmacSecret) {
    if (!cipherText) return null;
    const parts = String(cipherText).split(':');
    if (parts.length !== 3) throw new Error('Invalid cipher text format');
    const [ivB64, tagB64, dataB64] = parts;
    const key = deriveKey(secret);
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hmac(value, secret = config.security.signatureHmacSecret) {
    return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function generateToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

function generateNumericCode(digits = 6) {
    const max = 10 ** digits;
    return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

function constantTimeEqual(a, b) {
    if (!a || !b) return false;
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
    encrypt, decrypt, sha256, hmac, generateToken, generateNumericCode, constantTimeEqual
};

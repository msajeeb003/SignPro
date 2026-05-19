'use strict';

const fs = require('fs').promises;
const path = require('path');
const mammoth = require('mammoth');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const logger = require('../utils/logger');
const { parsePdf, ParseError } = require('./pdfParser');

/**
 * Parses a .docx file via mammoth, converts it to an intermediate PDF
 * (so it can be signed using the same coordinate-overlay system as PDFs),
 * and returns the same shape as parsePdf().
 *
 * Strategy: mammoth -> HTML/text -> generate paginated PDF with pdf-lib
 * -> reuse parsePdf to render pages, extract text, and compute metadata.
 */
async function parseDocx(filePath, options = {}) {
    let buffer;
    try {
        buffer = await fs.readFile(filePath);
    } catch (error) {
        throw new ParseError('Could not read DOCX file', 'FILE_NOT_READABLE', error);
    }

    let extraction;
    try {
        extraction = await mammoth.extractRawText({ buffer });
    } catch (error) {
        if (/zip|signature|format/i.test(error.message)) {
            throw new ParseError('DOCX file is corrupted or not a valid Word document', 'DOCX_CORRUPTED', error);
        }
        throw new ParseError(`Failed to parse DOCX: ${error.message}`, 'DOCX_PARSE_FAILED', error);
    }

    const rawText = (extraction.value || '').trim();
    if (!rawText) {
        throw new ParseError('DOCX file contains no extractable text', 'DOCX_EMPTY');
    }

    let htmlResult = { value: '' };
    try {
        htmlResult = await mammoth.convertToHtml({ buffer });
    } catch (error) {
        logger.warn('mammoth HTML conversion failed (text-only fallback)', { error: error.message });
    }

    const pdfBuffer = await generatePdfFromText(rawText, {
        title: options.title || path.basename(filePath, path.extname(filePath))
    });

    const intermediatePath = `${filePath}.pdf`;
    await fs.writeFile(intermediatePath, pdfBuffer);

    try {
        const parsed = await parsePdf(intermediatePath, options);
        return {
            ...parsed,
            metadata: {
                ...parsed.metadata,
                source: 'docx',
                docxWarnings: extraction.messages
                    ?.filter(m => m.type === 'warning')
                    .map(m => m.message) || []
            },
            originalFormat: 'docx',
            html: htmlResult.value,
            intermediatePdfPath: intermediatePath
        };
    } catch (error) {
        try { await fs.unlink(intermediatePath); } catch {}
        throw error;
    }
}

async function generatePdfFromText(text, { title } = {}) {
    const pdfDoc = await PDFDocument.create();
    if (title) pdfDoc.setTitle(title);
    pdfDoc.setCreator('SignPro DOCX Converter');
    pdfDoc.setProducer('pdf-lib + mammoth');
    pdfDoc.setCreationDate(new Date());

    const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

    const PAGE_WIDTH = 612;
    const PAGE_HEIGHT = 792;
    const MARGIN_X = 72;
    const MARGIN_TOP = 720;
    const MARGIN_BOTTOM = 72;
    const FONT_SIZE = 11;
    const LINE_HEIGHT = 16;
    const MAX_WIDTH = PAGE_WIDTH - 2 * MARGIN_X;

    const paragraphs = text.split(/\n{2,}/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean);

    let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = MARGIN_TOP;

    const drawLine = (line, useFont = font) => {
        if (y < MARGIN_BOTTOM) {
            page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            y = MARGIN_TOP;
        }
        page.drawText(line, { x: MARGIN_X, y, size: FONT_SIZE, font: useFont, color: rgb(0.1, 0.1, 0.1) });
        y -= LINE_HEIGHT;
    };

    for (const paragraph of paragraphs) {
        const looksLikeHeading = paragraph.length < 80 && paragraph === paragraph.toUpperCase();
        const useFont = looksLikeHeading ? fontBold : font;
        const lines = wrapText(paragraph, useFont, FONT_SIZE, MAX_WIDTH);
        for (const line of lines) drawLine(line, useFont);
        y -= LINE_HEIGHT / 2;
    }

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
}

function wrapText(text, font, size, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        const width = font.widthOfTextAtSize(candidate, size);
        if (width <= maxWidth) {
            current = candidate;
        } else {
            if (current) lines.push(current);
            if (font.widthOfTextAtSize(word, size) > maxWidth) {
                const chunks = chunkLongWord(word, font, size, maxWidth);
                for (let i = 0; i < chunks.length - 1; i++) lines.push(chunks[i]);
                current = chunks[chunks.length - 1] || '';
            } else {
                current = word;
            }
        }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
}

function chunkLongWord(word, font, size, maxWidth) {
    const chunks = [];
    let current = '';
    for (const ch of word) {
        const candidate = current + ch;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
            if (current) chunks.push(current);
            current = ch;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

module.exports = { parseDocx };

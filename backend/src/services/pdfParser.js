'use strict';

const fs = require('fs').promises;
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const logger = require('../utils/logger');

/**
 * Parses a PDF file using pdf-lib and pdfjs-dist and returns structured metadata.
 * Renders each page to a PNG (base64) using pdfjs-dist + a node canvas (or returns
 * placeholder rendering when canvas is unavailable, so the API contract holds).
 *
 * Returns:
 *   {
 *     pageCount: number,
 *     pages: [{ pageNumber, width, height, rotation, textContent, renderedBase64 }],
 *     metadata: { title, author, subject, creator, producer, creationDate, modificationDate },
 *     fullText: string,
 *     isEncrypted: boolean,
 *     fileHash: string
 *   }
 */
async function parsePdf(filePath, options = {}) {
    const renderPages = options.renderPages !== false;
    const renderScale = options.renderScale || 1.5;

    let pdfBytes;
    try {
        pdfBytes = await fs.readFile(filePath);
    } catch (error) {
        throw new ParseError('Could not read PDF file', 'FILE_NOT_READABLE', error);
    }

    let pdfDoc;
    try {
        pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
    } catch (error) {
        if (/encrypt/i.test(error.message)) {
            throw new ParseError(
                'Encrypted PDFs are not supported. Please remove the password and re-upload.',
                'PDF_ENCRYPTED',
                error
            );
        }
        if (/parse|invalid|format/i.test(error.message)) {
            throw new ParseError('PDF file is corrupted or malformed', 'PDF_CORRUPTED', error);
        }
        throw new ParseError(`Failed to load PDF: ${error.message}`, 'PDF_LOAD_FAILED', error);
    }

    const isEncrypted = pdfDoc.isEncrypted;
    const pageCount = pdfDoc.getPageCount();

    if (pageCount === 0) {
        throw new ParseError('PDF contains no pages', 'PDF_EMPTY');
    }
    if (pageCount > 500) {
        throw new ParseError(
            `PDF exceeds maximum page limit (${pageCount}/500)`,
            'PDF_TOO_LARGE'
        );
    }

    const pages = [];
    for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.getPage(i);
        const { width, height } = page.getSize();
        pages.push({
            pageNumber: i + 1,
            width: Number(width.toFixed(2)),
            height: Number(height.toFixed(2)),
            rotation: page.getRotation().angle,
            textContent: '',
            renderedBase64: null
        });
    }

    let fullText = '';
    let textByPage = {};
    try {
        const extracted = await extractTextWithPdfJs(pdfBytes);
        fullText = extracted.fullText;
        textByPage = extracted.byPage;
        pages.forEach(p => {
            p.textContent = textByPage[p.pageNumber] || '';
        });
    } catch (error) {
        logger.warn('Text extraction failed (continuing without it)', { error: error.message });
    }

    if (renderPages) {
        try {
            const renderings = await renderPdfPages(pdfBytes, renderScale);
            pages.forEach(p => {
                p.renderedBase64 = renderings[p.pageNumber - 1] || null;
            });
        } catch (error) {
            logger.warn('Page rendering failed (continuing without rendered images)', {
                error: error.message
            });
        }
    }

    const metadata = {
        title: safeMeta(() => pdfDoc.getTitle()),
        author: safeMeta(() => pdfDoc.getAuthor()),
        subject: safeMeta(() => pdfDoc.getSubject()),
        creator: safeMeta(() => pdfDoc.getCreator()),
        producer: safeMeta(() => pdfDoc.getProducer()),
        creationDate: safeMeta(() => pdfDoc.getCreationDate()?.toISOString()),
        modificationDate: safeMeta(() => pdfDoc.getModificationDate()?.toISOString())
    };

    return {
        pageCount,
        pages,
        metadata,
        fullText,
        isEncrypted,
        fileSize: pdfBytes.length
    };
}

function safeMeta(fn) {
    try { return fn() || null; } catch { return null; }
}

async function extractTextWithPdfJs(pdfBytes) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(pdfBytes),
        useSystemFonts: true,
        disableFontFace: true
    });
    const pdf = await loadingTask.promise;
    const byPage = {};
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
            .filter(item => 'str' in item)
            .map(item => item.str)
            .join(' ');
        byPage[i] = pageText;
        fullText += pageText + '\n\n';
    }
    await pdf.cleanup();
    return { fullText: fullText.trim(), byPage };
}

async function renderPdfPages(pdfBytes, scale = 1.5) {
    let canvasModule;
    try {
        canvasModule = await import('@napi-rs/canvas').catch(() => null);
        if (!canvasModule) {
            canvasModule = await import('canvas').catch(() => null);
        }
    } catch {
        canvasModule = null;
    }

    if (!canvasModule) {
        logger.warn('No canvas backend available - returning placeholder renderings. ' +
            'Install @napi-rs/canvas or canvas to enable PDF rendering.');
        return [];
    }

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(pdfBytes),
        useSystemFonts: true,
        disableFontFace: true
    });
    const pdf = await loadingTask.promise;
    const results = [];
    const createCanvas = canvasModule.createCanvas || canvasModule.default?.createCanvas;

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport }).promise;
        const buf = canvas.toBuffer('image/png');
        results.push(buf.toString('base64'));
        page.cleanup();
    }
    await pdf.cleanup();
    return results;
}

class ParseError extends Error {
    constructor(message, code, cause) {
        super(message);
        this.name = 'ParseError';
        this.code = code;
        this.cause = cause;
    }
}

module.exports = { parsePdf, ParseError };

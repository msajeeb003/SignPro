/**
 * Mock API service for NDA feature development.
 * Replaces real HTTP calls so the app works without a PostgreSQL database.
 * When integrating into the Next.js webapp, replace these mocks with real
 * fetch/axios calls to your Next.js API routes.
 */

const uuid = () => crypto.randomUUID();

// ── Agency defaults pre-filled in every NDA ──────────────────────────────────
const AGENCY = {
    name: 'My Agency',
    email: 'admin@myagency.com',
    address: '123 Agency Street, Dhaka, Bangladesh',
    representative: 'Agency Owner',
    designation: 'Managing Director',
    // Base64 placeholder signature image (thin green pen stroke)
    signatureDataUrl: null, // Will be set to agency default sig
};

// ── Pre-built NDA template content ───────────────────────────────────────────
const NDA_TEMPLATE_TEXT = `NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement ("Agreement") is entered into as of [DATE] between:

DISCLOSING PARTY:
${AGENCY.name}
${AGENCY.address}
(hereinafter "Agency")

RECEIVING PARTY:
[CLIENT NAME]
[CLIENT EMAIL]
(hereinafter "Client")

1. CONFIDENTIAL INFORMATION
The Agency may disclose to the Client certain confidential and proprietary information ("Confidential Information") for the purpose of evaluating a potential business relationship.

2. OBLIGATIONS
The Client agrees to:
(a) Hold the Confidential Information in strict confidence;
(b) Not disclose the Confidential Information to any third party without prior written consent;
(c) Use the Confidential Information solely for the Purpose stated herein.

3. TERM
This Agreement shall remain in effect for two (2) years from the date of execution.

4. GOVERNING LAW
This Agreement shall be governed by applicable law.

IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.

FOR THE AGENCY:
${AGENCY.name}
Signature: _________________________ [AGENCY SIGNATURE]
Name: ${AGENCY.representative}
Title: ${AGENCY.designation}
Date: ${new Date().toLocaleDateString()}

FOR THE CLIENT:
Signature: _________________________
Name: _________________________
Title / Designation: _________________________
Date: _________________________
`;

// ── In-memory "database" ─────────────────────────────────────────────────────
let ndaRequests = [];

// ── Helper: simulate async delay ─────────────────────────────────────────────
const delay = (ms = 300) => new Promise(r => setTimeout(r, ms));

// ── Exported mock API ─────────────────────────────────────────────────────────

export const mockDocuments = {
    list: async () => {
        await delay();
        return {
            documents: ndaRequests.map(r => ({
                id: r.id,
                title: r.title,
                status: r.status,
                document_type: 'pdf',
                page_count: 1,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })),
            total: ndaRequests.length
        };
    },
    get: async (id) => {
        await delay();
        const r = ndaRequests.find(d => d.id === id);
        if (!r) throw { response: { data: { error: 'Not found' } } };
        return r;
    },
};

export const mockNda = {
    /**
     * Send an NDA to a client.
     * Returns { token, signingLink }
     */
    send: async ({ clientName, clientEmail, message }) => {
        await delay(600);
        const id = uuid();
        const token = uuid().replace(/-/g, '');
        const record = {
            id,
            title: `NDA — ${clientName}`,
            token,
            clientName,
            clientEmail,
            message: message || '',
            status: 'sent',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            templateText: NDA_TEMPLATE_TEXT
                .replace('[CLIENT NAME]', clientName)
                .replace('[CLIENT EMAIL]', clientEmail)
                .replace('[DATE]', new Date().toLocaleDateString()),
        };
        ndaRequests.push(record);
        return {
            id,
            token,
            signingLink: `${window.location.origin}/sign/${token}`,
            clientName,
            clientEmail,
        };
    },

    /**
     * Get the signing session for a given token (called from the public sign page).
     */
    getSession: async (token) => {
        await delay(400);
        const r = ndaRequests.find(d => d.token === token);
        if (!r) throw { response: { data: { error: 'Invalid or expired link' } } };
        if (r.status === 'completed') throw { response: { data: { error: 'Already signed' } } };

        return {
            document: { title: r.title, id: r.id },
            sender: { name: AGENCY.name, email: AGENCY.email },
            signatureRequest: {
                id: r.id,
                signer_name: r.clientName,
                signer_email: r.clientEmail,
                message: r.message,
            },
            fields: [
                { id: 'sig-1',    field_type: 'signature', label: 'Your Signature',    page_number: 1, is_required: true,  x_position: 60,  y_position: 72, width: 28, height: 6,  page_width: 100, page_height: 100 },
                { id: 'date-1',   field_type: 'date',      label: 'Date',              page_number: 1, is_required: true,  x_position: 60,  y_position: 79, width: 15, height: 4,  page_width: 100, page_height: 100 },
                { id: 'desg-1',   field_type: 'text',      label: 'Designation/Title', page_number: 1, is_required: true,  x_position: 60,  y_position: 84, width: 25, height: 4,  page_width: 100, page_height: 100, placeholder: 'e.g. CEO, Founder...' },
            ],
            ndaText: r.templateText,
            agencySignature: AGENCY.signatureDataUrl,
        };
    },

    /**
     * Complete the signing (called when client submits their signature).
     */
    complete: async (token, { fieldValues, consent }) => {
        await delay(800);
        const r = ndaRequests.find(d => d.token === token);
        if (!r) throw { response: { data: { error: 'Invalid token' } } };

        r.status = 'completed';
        r.signed_at = new Date().toISOString();
        r.updated_at = r.signed_at;
        r.fieldValues = fieldValues;

        return {
            signedAt: r.signed_at,
            documentHash: 'sha256-' + Math.random().toString(36).substr(2, 40),
            verification: {
                evidenceId: 'ev-' + uuid().replace(/-/g, '').substr(0, 16),
            },
        };
    },

    decline: async (token) => {
        await delay(300);
        const r = ndaRequests.find(d => d.token === token);
        if (r) { r.status = 'declined'; r.updated_at = new Date().toISOString(); }
        return { success: true };
    },
};

// ── Re-export no-op stubs for parts of the app not yet mocked ────────────────
export const auth = {
    login: async () => ({}),
    register: async () => ({}),
    logout: async () => {},
    me: async () => ({ id: 'owner', email: 'admin@myagency.com', full_name: 'Agency Owner' }),
};

export const documents = mockDocuments;
export const signatures = {
    getSession: (token) => mockNda.getSession(token),
    getSessionPages: async () => ({ pages: [] }),  // pages rendered via NDA text in sign page
    complete: (token, data) => mockNda.complete(token, data),
    decline: (token) => mockNda.decline(token),
    createRequests: async () => ({}),
    resend: async () => ({}),
    cancel: async () => ({}),
    verify: async () => ({}),
};
export const smtp = {
    list: async () => [],
    create: async () => ({}),
    update: async () => ({}),
    test: async () => ({}),
    setDefault: async () => ({}),
    delete: async () => ({}),
};

export function setTokens() {}
export function clearTokens() {}
export function getAccessToken() { return 'mock-token'; }

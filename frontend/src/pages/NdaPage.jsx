import React, { useState } from 'react';
import { mockNda } from '../services/api.js';

const NDA_PREVIEW = `NON-DISCLOSURE AGREEMENT

This Agreement is entered into between your Agency and the Client named below.

1. CONFIDENTIAL INFORMATION – The Agency may share proprietary information solely for evaluating a business relationship.
2. OBLIGATIONS – The Client agrees to hold all information in strict confidence and not disclose it to any third party.
3. TERM – This Agreement remains in effect for two (2) years from the date of signing.
4. GOVERNING LAW – Applicable national/local law governs this Agreement.

Your agency's details, representative name, and pre-applied digital signature will be automatically included. The client will sign digitally via a secure link.`;

export default function NdaPage() {
    const [clientName, setClientName] = useState('');
    const [clientEmail, setClientEmail] = useState('');
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!clientName.trim() || !clientEmail.trim()) return;
        setSending(true);
        setError(null);
        try {
            const res = await mockNda.send({ clientName, clientEmail, message });
            setResult(res);
        } catch (err) {
            setError(err?.response?.data?.error || 'Failed to send NDA. Please try again.');
        } finally {
            setSending(false);
        }
    };

    const copyLink = () => {
        navigator.clipboard.writeText(result.signingLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const reset = () => { setResult(null); setClientName(''); setClientEmail(''); setMessage(''); };

    if (result) {
        return (
            <div className="nda-page">
                <div className="nda-success">
                    <div className="nda-success-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                    </div>
                    <h1>NDA Sent Successfully!</h1>
                    <p className="muted">
                        Sent to <strong>{result.clientName}</strong> &lt;{result.clientEmail}&gt;
                    </p>

                    <div className="nda-link-card">
                        <p className="nda-link-label">Client Signing Link</p>
                        <div className="nda-link-row">
                            <code className="nda-link-url">{result.signingLink}</code>
                            <button className={`btn btn-primary ${copied ? 'copied' : ''}`} onClick={copyLink}>
                                {copied ? '✓ Copied!' : 'Copy Link'}
                            </button>
                        </div>
                        <p className="nda-link-hint muted">
                            Share this link with your client, or they will receive it via email. The link opens a secure signing page.
                        </p>
                    </div>

                    <div className="nda-test-note">
                        <strong>🔧 Test the signing flow:</strong>{' '}
                        <a href={result.signingLink} target="_blank" rel="noreferrer">Open signing page →</a>
                    </div>

                    <button className="btn" onClick={reset} style={{ marginTop: 24 }}>
                        Send Another NDA
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="nda-page">
            <div className="page-header">
                <div>
                    <h1>Send NDA</h1>
                    <p className="meta">Agency Non-Disclosure Agreement — pre-signed by your agency</p>
                </div>
            </div>

            <div className="nda-layout">
                {/* Left: Preview */}
                <div className="nda-preview-panel">
                    <div className="nda-preview-header">
                        <span className="nda-preview-badge">Template Preview</span>
                        <span className="nda-preview-badge success">Agency Pre-Signed ✓</span>
                    </div>
                    <div className="nda-preview-doc">
                        <div className="nda-preview-title">NON-DISCLOSURE AGREEMENT</div>
                        <pre className="nda-preview-text">{NDA_PREVIEW}</pre>
                        <div className="nda-preview-sig-row">
                            <div className="nda-preview-sig-block">
                                <div className="nda-preview-sig-line">
                                    <span className="nda-preview-sig-agency">Agency Owner</span>
                                </div>
                                <span className="nda-preview-sig-label">Agency Signature (pre-applied)</span>
                            </div>
                            <div className="nda-preview-sig-block client">
                                <div className="nda-preview-sig-line empty">
                                    <span className="nda-preview-sig-placeholder">Client signs here</span>
                                </div>
                                <span className="nda-preview-sig-label">Client Signature</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right: Send Form */}
                <div className="nda-form-panel">
                    <h2>Client Details</h2>
                    <p className="muted" style={{ marginBottom: 20 }}>
                        The client will receive a secure link to digitally sign the NDA with their signature, date, and designation.
                    </p>
                    <form className="nda-form" onSubmit={handleSend}>
                        <label>
                            Client Full Name *
                            <input
                                type="text"
                                id="nda-client-name"
                                value={clientName}
                                onChange={e => setClientName(e.target.value)}
                                placeholder="e.g. John Smith"
                                required
                            />
                        </label>
                        <label>
                            Client Email *
                            <input
                                type="email"
                                id="nda-client-email"
                                value={clientEmail}
                                onChange={e => setClientEmail(e.target.value)}
                                placeholder="client@example.com"
                                required
                            />
                        </label>
                        <label>
                            Personal Message (optional)
                            <textarea
                                id="nda-message"
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                placeholder="Please review and sign the attached NDA before we proceed..."
                                rows={3}
                            />
                        </label>

                        <div className="nda-form-info">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            Your agency details and digital signature are automatically included. The client will be asked for their <strong>signature</strong>, <strong>date</strong>, and <strong>designation</strong>.
                        </div>

                        {error && <div className="error">{error}</div>}

                        <button type="submit" id="nda-send-btn" className="btn btn-primary btn-large" disabled={sending || !clientName || !clientEmail}>
                            {sending ? 'Sending...' : 'Send NDA to Client'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

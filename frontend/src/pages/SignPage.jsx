import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { signatures } from '../services/api.js';

export default function SignPage() {
    const { token } = useParams();
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [designation, setDesignation] = useState('');
    const [consent, setConsent] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [completed, setCompleted] = useState(null);
    const sigPad = useRef(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await signatures.getSession(token);
                setSession(data);
            } catch (err) {
                setError(err.response?.data?.error || 'This link is invalid or has expired.');
            } finally {
                setLoading(false);
            }
        })();
    }, [token]);

    const hasSig = () => sigPad.current && !sigPad.current.isEmpty();
    const canSubmit = hasSig() && date && designation.trim() && consent;

    const submit = async () => {
        if (!hasSig()) { alert('Please draw your signature first.'); return; }
        if (!designation.trim()) { alert('Please enter your designation.'); return; }
        if (!consent) { alert('Please accept the electronic signature consent.'); return; }

        setSubmitting(true);
        setError(null);
        try {
            const sigDataUrl = sigPad.current.toDataURL('image/png');
            const result = await signatures.complete(token, {
                fieldValues: [
                    { field_id: 'sig-1',  value: session.signatureRequest.signer_name, image_data: sigDataUrl },
                    { field_id: 'date-1', value: date },
                    { field_id: 'desg-1', value: designation },
                ],
                consent: {
                    accepted: true,
                    accepted_at: new Date().toISOString(),
                    text: 'I consent to electronic signature.',
                },
            });
            setCompleted(result);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to submit. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const decline = async () => {
        if (!window.confirm('Are you sure you want to decline this NDA?')) return;
        try {
            await signatures.decline(token);
            setError('You have declined to sign this document. You may close this window.');
            setSession(null);
        } catch {}
    };

    // ── States ──────────────────────────────────────────────────────────────

    if (loading) return (
        <div className="sign-page-loading">
            <div className="sign-loading-inner">
                <div className="sign-spinner"></div>
                <p>Loading your document…</p>
            </div>
        </div>
    );

    if (completed) return (
        <div className="sign-page-complete">
            <div className="complete-card">
                <div className="complete-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                </div>
                <h1>Document Signed!</h1>
                <p>Thank you, <strong>{session?.signatureRequest?.signer_name}</strong>. Your signature has been recorded.</p>
                <p className="muted">Signed at: {new Date(completed.signedAt).toLocaleString()}</p>
                <p className="muted">Document hash: <code>{completed.documentHash}</code></p>
                <p className="muted">Evidence ID: <code>{completed.verification.evidenceId}</code></p>
                <p style={{ marginTop: 16 }}>A confirmation will be emailed to you. You may close this window.</p>
            </div>
        </div>
    );

    if (error && !session) return (
        <div className="sign-page-error">
            <div className="error-card">
                <div className="error-icon">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                </div>
                <h1>Unable to Load Document</h1>
                <p>{error}</p>
            </div>
        </div>
    );

    if (!session) return null;

    return (
        <div className="sign-page">
            {/* Header */}
            <header className="sign-header">
                <div className="sign-header-brand">
                    <span className="sign-brand-mark"></span>
                    <span className="sign-brand-name">Sign<strong>Pro</strong></span>
                </div>
                <div className="sign-header-doc">
                    <h1>{session.document.title}</h1>
                    <p className="muted">
                        From <strong>{session.sender.name}</strong> · {session.sender.email}
                    </p>
                    {session.signatureRequest.message && (
                        <blockquote className="sign-message">{session.signatureRequest.message}</blockquote>
                    )}
                </div>
                <button onClick={decline} className="btn btn-danger sign-decline-btn">
                    Decline
                </button>
            </header>

            {/* Main */}
            <div className="sign-layout">
                {/* Document Preview */}
                <div className="document-viewer">
                    <div className="nda-text-doc">
                        <div className="nda-text-header">
                            <span className="nda-text-badge">Non-Disclosure Agreement</span>
                        </div>
                        <pre className="nda-text-body">{session.ndaText}</pre>
                        <div className="nda-text-sigs">
                            <div className="nda-sig-block signed">
                                <div className="nda-sig-line agency">
                                    <svg width="60" height="24" viewBox="0 0 60 24">
                                        <path d="M5,18 Q10,8 15,12 Q20,16 25,10 Q30,4 35,10 Q40,16 45,12 Q50,8 55,14"
                                              fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round"/>
                                    </svg>
                                </div>
                                <span className="nda-sig-label">Agency (pre-signed)</span>
                                <span className="nda-sig-name">{session.sender.name}</span>
                            </div>
                            <div className="nda-sig-block pending">
                                <div className="nda-sig-line empty">
                                    <span>Your signature goes here</span>
                                </div>
                                <span className="nda-sig-label">Client (you)</span>
                                <span className="nda-sig-name">{session.signatureRequest.signer_name}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Signing Sidebar */}
                <aside className="sign-sidebar">
                    <div className="sign-sidebar-inner">
                        <h2>Sign this document</h2>
                        <p className="muted sign-sidebar-sub">Complete all 3 fields below to finish signing.</p>

                        <ol className="sign-steps">
                            <li className={`sign-step ${sigPad.current && !sigPad.current?.isEmpty() ? 'done' : 'active'}`}>
                                <span className="step-num">1</span>
                                <div className="step-content">
                                    <strong>Draw your signature</strong>
                                    <div className="sig-canvas-wrapper">
                                        <SignatureCanvas
                                            ref={sigPad}
                                            canvasProps={{ width: 300, height: 110, className: 'sig-canvas' }}
                                            penColor="#14532d"
                                        />
                                    </div>
                                    <button onClick={() => sigPad.current?.clear()} className="btn btn-link sign-clear-btn">
                                        Clear signature
                                    </button>
                                </div>
                            </li>

                            <li className={`sign-step ${date ? 'done' : ''}`}>
                                <span className="step-num">2</span>
                                <div className="step-content">
                                    <strong>Date</strong>
                                    <input
                                        type="date"
                                        id="sign-date"
                                        value={date}
                                        onChange={e => setDate(e.target.value)}
                                    />
                                </div>
                            </li>

                            <li className={`sign-step ${designation.trim() ? 'done' : ''}`}>
                                <span className="step-num">3</span>
                                <div className="step-content">
                                    <strong>Your Designation / Title</strong>
                                    <input
                                        type="text"
                                        id="sign-designation"
                                        value={designation}
                                        onChange={e => setDesignation(e.target.value)}
                                        placeholder="e.g. CEO, Founder, Director…"
                                    />
                                </div>
                            </li>
                        </ol>

                        <label className="consent">
                            <input type="checkbox" id="sign-consent" checked={consent}
                                onChange={e => setConsent(e.target.checked)} />
                            <span>
                                I agree that my electronic signature has the same legal effect as a
                                handwritten signature (E-SIGN Act / UETA).
                            </span>
                        </label>

                        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

                        <button
                            id="sign-submit-btn"
                            onClick={submit}
                            disabled={submitting || !consent}
                            className="btn btn-primary btn-large sign-submit"
                        >
                            {submitting ? 'Submitting…' : 'Submit Signature'}
                        </button>

                        <p className="sign-security-note muted">
                            🔒 Secured by HMAC · SHA-256 · Your IP and timestamp are recorded.
                        </p>
                    </div>
                </aside>
            </div>
        </div>
    );
}

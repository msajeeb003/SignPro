import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { signatures } from '../services/api.js';

export default function SignPage() {
    const { token } = useParams();
    const [session, setSession] = useState(null);
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [fieldValues, setFieldValues] = useState({});
    const [consent, setConsent] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [completed, setCompleted] = useState(null);
    const [verificationCode, setVerificationCode] = useState('');
    const [activeField, setActiveField] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await signatures.getSession(token);
                setSession(data);
                const pagesData = await signatures.getSessionPages(token);
                setPages(pagesData.pages || []);
            } catch (err) {
                setError(err.response?.data?.error || err.response?.data?.code || 'Failed to load');
            } finally {
                setLoading(false);
            }
        })();
    }, [token]);

    const setFieldValue = (fieldId, value, imageData) => {
        setFieldValues(prev => ({
            ...prev,
            [fieldId]: { field_id: fieldId, value, image_data: imageData }
        }));
    };

    const allRequiredFilled = () => {
        if (!session) return false;
        return session.fields
            .filter(f => f.is_required)
            .every(f => fieldValues[f.id]);
    };

    const submit = async () => {
        if (!consent) {
            alert('You must accept the electronic signature consent.');
            return;
        }
        if (!allRequiredFilled()) {
            alert('Please complete all required fields.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const result = await signatures.complete(token, {
                fieldValues: Object.values(fieldValues),
                consent: {
                    accepted: true,
                    accepted_at: new Date().toISOString(),
                    text: 'I agree that my electronic signature has the same legal effect as a handwritten signature, and I consent to receive and sign documents electronically.',
                    geolocation: await getGeolocation()
                },
                verificationCode: verificationCode || undefined
            });
            setCompleted(result);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to submit signature');
        } finally {
            setSubmitting(false);
        }
    };

    const decline = async () => {
        const reason = prompt('Reason for declining (optional):');
        if (reason === null) return;
        try {
            await signatures.decline(token, reason || undefined);
            setError('You have declined to sign this document.');
            setSession(null);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to decline');
        }
    };

    if (loading) return <div className="sign-page-loading">Loading document...</div>;

    if (completed) {
        return (
            <div className="sign-page-complete">
                <div className="complete-card">
                    <h1>✓ Signature Complete</h1>
                    <p>Thank you. Your signature has been recorded.</p>
                    <p className="muted">Signed at: {new Date(completed.signedAt).toLocaleString()}</p>
                    <p className="muted">Document hash: <code>{completed.documentHash}</code></p>
                    <p className="muted">Verification ID: <code>{completed.verification.evidenceId}</code></p>
                    <p>You may close this window. A confirmation email has been sent.</p>
                </div>
            </div>
        );
    }

    if (error && !session) {
        return (
            <div className="sign-page-error">
                <div className="error-card">
                    <h1>Unable to load document</h1>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    if (!session) return null;

    return (
        <div className="sign-page">
            <header className="sign-header">
                <div>
                    <h1>{session.document.title}</h1>
                    <p className="muted">
                        From <strong>{session.sender.name}</strong> ({session.sender.email})
                    </p>
                    {session.signatureRequest.message && (
                        <blockquote>{session.signatureRequest.message}</blockquote>
                    )}
                </div>
                <div className="sign-actions">
                    <button onClick={decline} className="btn btn-danger">Decline</button>
                </div>
            </header>

            <div className="sign-layout">
                <div className="document-viewer">
                    {pages.map(page => (
                        <PageWithFields
                            key={page.pageNumber}
                            page={page}
                            fields={session.fields.filter(f => f.page_number === page.pageNumber)}
                            fieldValues={fieldValues}
                            onFieldClick={setActiveField}
                            onFieldChange={setFieldValue}
                            signerName={session.signatureRequest.signer_name}
                        />
                    ))}
                </div>

                <aside className="sign-sidebar">
                    <h2>Sign this document</h2>
                    <p className="muted">
                        {Object.keys(fieldValues).length} / {session.fields.length} fields completed
                    </p>

                    <ol className="field-list">
                        {session.fields.map((field, idx) => (
                            <li key={field.id}
                                className={fieldValues[field.id] ? 'completed' : 'pending'}>
                                <span className="field-num">{idx + 1}</span>
                                <div>
                                    <strong>{field.label || field.field_type}</strong>
                                    <span className="muted">Page {field.page_number}</span>
                                </div>
                                {fieldValues[field.id] && <span className="check">✓</span>}
                            </li>
                        ))}
                    </ol>

                    <div className="verification">
                        <label>Verification code (if provided)
                            <input type="text" value={verificationCode}
                                onChange={e => setVerificationCode(e.target.value)}
                                placeholder="6-digit code" maxLength="6" />
                        </label>
                    </div>

                    <label className="consent">
                        <input type="checkbox" checked={consent}
                            onChange={e => setConsent(e.target.checked)} />
                        <span>
                            I agree that my electronic signature has the same legal effect as a
                            handwritten signature, and I consent to receive and sign documents
                            electronically (E-SIGN Act / UETA).
                        </span>
                    </label>

                    {error && <div className="error">{error}</div>}

                    <button onClick={submit}
                        disabled={submitting || !consent || !allRequiredFilled()}
                        className="btn btn-primary btn-large">
                        {submitting ? 'Submitting...' : 'Finish Signing'}
                    </button>
                </aside>
            </div>

            {activeField && (
                <FieldEditor
                    field={activeField}
                    initialValue={fieldValues[activeField.id]}
                    signerName={session.signatureRequest.signer_name}
                    onSave={(value, imageData) => {
                        setFieldValue(activeField.id, value, imageData);
                        setActiveField(null);
                    }}
                    onClose={() => setActiveField(null)}
                />
            )}
        </div>
    );
}

function PageWithFields({ page, fields, fieldValues, onFieldClick, signerName }) {
    return (
        <div className="page-container" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
            {page.imageDataUrl
                ? <img src={page.imageDataUrl} alt={`Page ${page.pageNumber}`} className="page-image" />
                : <div className="page-image-placeholder">Page {page.pageNumber}</div>
            }
            {fields.map(field => {
                const value = fieldValues[field.id];
                const pctX = (Number(field.x_position) / Number(field.page_width)) * 100;
                const pctY = (Number(field.y_position) / Number(field.page_height)) * 100;
                const pctW = (Number(field.width) / Number(field.page_width)) * 100;
                const pctH = (Number(field.height) / Number(field.page_height)) * 100;
                return (
                    <button key={field.id}
                        type="button"
                        className={`field-overlay ${value ? 'filled' : 'empty'}`}
                        style={{
                            left: `${pctX}%`, top: `${pctY}%`,
                            width: `${pctW}%`, height: `${pctH}%`
                        }}
                        onClick={() => onFieldClick(field)}
                        title={field.label || field.field_type}>
                        {value
                            ? (field.field_type === 'signature' && value.image_data
                                ? <img src={value.image_data} alt="signature" />
                                : <span>{value.value || signerName}</span>)
                            : <span className="field-hint">{field.label || field.field_type}</span>}
                    </button>
                );
            })}
        </div>
    );
}

function FieldEditor({ field, initialValue, signerName, onSave, onClose }) {
    const sigPad = useRef(null);
    const [text, setText] = useState(initialValue?.value || '');

    const saveSignature = () => {
        if (!sigPad.current || sigPad.current.isEmpty()) {
            alert('Please draw your signature');
            return;
        }
        const dataUrl = sigPad.current.toDataURL('image/png');
        onSave(signerName, dataUrl);
    };

    const saveText = () => {
        if (!text.trim()) return;
        onSave(text.trim());
    };

    return (
        <div className="modal">
            <div className="modal-form">
                <h2>{field.label || field.field_type}</h2>

                {(field.field_type === 'signature' || field.field_type === 'initial') && (
                    <>
                        <div className="sig-canvas-wrapper">
                            <SignatureCanvas ref={sigPad}
                                canvasProps={{ width: 500, height: 200, className: 'sig-canvas' }}
                                penColor="rgb(15, 23, 80)" />
                        </div>
                        <div className="actions">
                            <button onClick={() => sigPad.current?.clear()} className="btn">Clear</button>
                            <button onClick={saveSignature} className="btn btn-primary">Apply signature</button>
                        </div>
                    </>
                )}

                {field.field_type === 'date' && (
                    <>
                        <input type="date" value={text}
                            onChange={e => setText(e.target.value)} />
                        <div className="actions">
                            <button onClick={saveText} className="btn btn-primary">Apply</button>
                        </div>
                    </>
                )}

                {field.field_type === 'text' && (
                    <>
                        <input type="text" value={text}
                            onChange={e => setText(e.target.value)}
                            placeholder={field.placeholder || 'Enter value'} />
                        <div className="actions">
                            <button onClick={saveText} className="btn btn-primary">Apply</button>
                        </div>
                    </>
                )}

                {field.field_type === 'checkbox' && (
                    <>
                        <label className="checkbox">
                            <input type="checkbox" checked={text === 'true'}
                                onChange={e => setText(e.target.checked ? 'true' : 'false')} />
                            {field.label || 'I agree'}
                        </label>
                        <div className="actions">
                            <button onClick={saveText} className="btn btn-primary">Apply</button>
                        </div>
                    </>
                )}

                <button onClick={onClose} className="btn btn-link">Cancel</button>
            </div>
        </div>
    );
}

async function getGeolocation() {
    if (!navigator.geolocation) return null;
    return new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
            pos => resolve({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            }),
            () => resolve(null),
            { timeout: 5000, enableHighAccuracy: false }
        );
    });
}

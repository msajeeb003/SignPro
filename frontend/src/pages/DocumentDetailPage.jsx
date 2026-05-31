import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { documents, signatures } from '../services/api.js';

export default function DocumentDetailPage() {
    const { id } = useParams();
    const [doc, setDoc] = useState(null);
    const [sigRequests, setSigRequests] = useState([]);
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showSendForm, setShowSendForm] = useState(false);

    const refresh = async () => {
        setLoading(true);
        try {
            const data = await documents.get(id);
            setDoc(data.document);
            setSigRequests(data.signatureRequests || []);
            if (data.document.status !== 'voided' && data.document.status !== 'failed') {
                const pagesData = await documents.getPages(id);
                setPages(pagesData.pages || []);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load document');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { refresh(); }, [id]);

    if (loading) return <p>Loading...</p>;
    if (error) return <div className="error">{error}</div>;
    if (!doc) return <p>Document not found</p>;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>{doc.title}</h1>
                    <p className="meta">{doc.document_type?.toUpperCase()} - {doc.page_count} page(s) - Status: {doc.status}</p>
                </div>
                <div className="actions">
                    {(doc.status === 'ready' || doc.status === 'uploaded') &&
                        <Link to={`/documents/${doc.id}/edit`} className="btn btn-primary">
                            Prepare & Send
                        </Link>
                    }
                    {(doc.status === 'sent' || doc.status === 'partially_signed') &&
                        <Link to={`/documents/${doc.id}/edit`} className="btn">
                            Add more signers
                        </Link>
                    }
                    {doc.status === 'completed' &&
                        <a href={`/api/documents/${doc.id}/download?variant=signed`} className="btn btn-primary">
                            Download signed PDF
                        </a>
                    }
                </div>
            </div>

            {showSendForm && (
                <SendForSignatureForm
                    documentId={doc.id}
                    pages={pages}
                    onClose={() => setShowSendForm(false)}
                    onSent={() => { setShowSendForm(false); refresh(); }}
                />
            )}

            <section className="section">
                <h2>Signature Requests</h2>
                {sigRequests.length === 0 && <p className="muted">No signature requests yet.</p>}
                {sigRequests.length > 0 && (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Signer</th><th>Email</th><th>Status</th>
                                <th>Sent</th><th>Signed</th><th>Expires</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sigRequests.map(sr => (
                                <tr key={sr.id}>
                                    <td>{sr.signer_name}</td>
                                    <td>{sr.signer_email}</td>
                                    <td><span className={`status status-${sr.status}`}>{sr.status}</span></td>
                                    <td>{sr.sent_at ? new Date(sr.sent_at).toLocaleString() : '-'}</td>
                                    <td>{sr.signed_at ? new Date(sr.signed_at).toLocaleString() : '-'}</td>
                                    <td>{new Date(sr.expires_at).toLocaleDateString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            <section className="section">
                <h2>Document Preview</h2>
                <div className="page-previews">
                    {pages.map(p => (
                        <div key={p.pageNumber} className="page-preview">
                            <div className="page-number">Page {p.pageNumber}</div>
                            {p.imageDataUrl
                                ? <img src={p.imageDataUrl} alt={`Page ${p.pageNumber}`} />
                                : <div className="page-placeholder">Preview unavailable - install a canvas backend</div>}
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

function SendForSignatureForm({ documentId, pages, onClose, onSent }) {
    const [recipients, setRecipients] = useState([{
        email: '', name: '', phone: '', message: '',
        fields: [{
            field_type: 'signature', page_number: 1,
            x: 100, y: 600, width: 200, height: 60,
            page_width: pages[0]?.width || 612,
            page_height: pages[0]?.height || 792,
            label: 'Sign here', is_required: true
        }]
    }]);
    const [notifyEmail, setNotifyEmail] = useState(true);
    const [notifySms, setNotifySms] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState(null);

    const updateRecipient = (idx, key, val) => {
        setRecipients(r => r.map((rec, i) => i === idx ? { ...rec, [key]: val } : rec));
    };

    const submit = async (e) => {
        e.preventDefault();
        setSending(true);
        setError(null);
        try {
            await signatures.createRequests({
                documentId,
                recipients,
                notify: { email: notifyEmail, sms: notifySms }
            });
            onSent();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to send');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="modal">
            <form onSubmit={submit} className="modal-form">
                <h2>Send for Signature</h2>
                {recipients.map((r, idx) => (
                    <fieldset key={idx} className="recipient-fieldset">
                        <legend>Recipient {idx + 1}</legend>
                        <label>Name
                            <input type="text" value={r.name}
                                onChange={e => updateRecipient(idx, 'name', e.target.value)} required />
                        </label>
                        <label>Email
                            <input type="email" value={r.email}
                                onChange={e => updateRecipient(idx, 'email', e.target.value)} required />
                        </label>
                        <label>Phone (optional, E.164)
                            <input type="tel" value={r.phone}
                                onChange={e => updateRecipient(idx, 'phone', e.target.value)}
                                placeholder="+15551234567" />
                        </label>
                        <label>Message (optional)
                            <textarea value={r.message}
                                onChange={e => updateRecipient(idx, 'message', e.target.value)} />
                        </label>
                        <p className="muted">
                            A signature field will be placed on page {r.fields[0].page_number}.
                            For coordinate customization, use the API directly or extend this UI.
                        </p>
                    </fieldset>
                ))}
                <label className="checkbox">
                    <input type="checkbox" checked={notifyEmail}
                        onChange={e => setNotifyEmail(e.target.checked)} />
                    Send email notification
                </label>
                <label className="checkbox">
                    <input type="checkbox" checked={notifySms}
                        onChange={e => setNotifySms(e.target.checked)} />
                    Send SMS notification (requires recipient phone)
                </label>
                {error && <div className="error">{error}</div>}
                <div className="modal-actions">
                    <button type="button" onClick={onClose} className="btn">Cancel</button>
                    <button type="submit" disabled={sending} className="btn btn-primary">
                        {sending ? 'Sending...' : 'Send'}
                    </button>
                </div>
            </form>
        </div>
    );
}

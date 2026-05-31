import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { documents, signatures } from '../services/api.js';
import { useAuth } from '../services/auth.jsx';

const TOOLS = [
    { id: 'select', label: 'Select', icon: 'cursor' },
    { id: 'signature', label: 'Signature', icon: 'sign', requiresSize: { w: 200, h: 60 } },
    { id: 'initial', label: 'Initials', icon: 'initial', requiresSize: { w: 80, h: 40 } },
    { id: 'date', label: 'Date', icon: 'date', requiresSize: { w: 130, h: 32 } },
    { id: 'text', label: 'Text', icon: 'text', requiresSize: { w: 180, h: 32 } },
    { id: 'note', label: 'Note', icon: 'note', requiresSize: { w: 200, h: 80 } },
    { id: 'checkbox', label: 'Checkbox', icon: 'check', requiresSize: { w: 24, h: 24 } }
];

const SIGNER_COLORS = ['#34C759', '#007AFF', '#FF9500', '#AF52DE', '#FF3B30', '#5AC8FA'];

function ToolIcon({ name }) {
    const paths = {
        cursor: <path d="M5 3l14 7-7 2-2 7-5-16z" />,
        sign: <><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/><path d="M14.06 6.19l3.75 3.75 1.59-1.59a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0L14.06 6.19z"/></>,
        initial: <><path d="M5 4h14v3H5z"/><path d="M7 11h10M7 16h6"/></>,
        date: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
        text: <><path d="M4 7V5h16v2"/><path d="M9 5v14M15 19h-6"/></>,
        note: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></>,
        check: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></>,
        plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
        trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,
        back: <><polyline points="15 18 9 12 15 6"/></>,
        send: <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
        save: <><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,
        user: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
        me: <><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></>
    };
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {paths[name]}
        </svg>
    );
}

export default function DocumentEditorPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [doc, setDoc] = useState(null);
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [tool, setTool] = useState('select');
    const [signers, setSigners] = useState(() => [
        {
            id: 'me',
            isMe: true,
            name: user?.full_name || user?.email || 'Me',
            email: user?.email || '',
            color: SIGNER_COLORS[0]
        }
    ]);
    const [activeSignerId, setActiveSignerId] = useState('me');
    const [fields, setFields] = useState([]);
    const [activeField, setActiveField] = useState(null);
    const [sending, setSending] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    const [showAddSigner, setShowAddSigner] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const data = await documents.get(id);
                if (!['ready', 'sent', 'partially_signed', 'uploaded'].includes(data.document.status)) {
                    setError(`This document cannot be edited (status: ${data.document.status})`);
                    return;
                }
                setDoc(data.document);
                const pagesData = await documents.getPages(id);
                setPages(pagesData.pages || []);
            } catch (err) {
                setError(err.response?.data?.error || 'Failed to load document');
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    const activeSigner = signers.find(s => s.id === activeSignerId) || signers[0];
    const signerById = useMemo(() => Object.fromEntries(signers.map(s => [s.id, s])), [signers]);
    const fieldsBySigner = useMemo(() => {
        const map = {};
        for (const s of signers) map[s.id] = fields.filter(f => f.signer_id === s.id);
        return map;
    }, [fields, signers]);

    const handlePageClick = (pageNumber, pageWidth, pageHeight, e) => {
        if (tool === 'select') return;
        const toolDef = TOOLS.find(t => t.id === tool);
        if (!toolDef?.requiresSize) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const scaleX = pageWidth / rect.width;
        const scaleY = pageHeight / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;

        const fieldX = Math.max(0, clickX - toolDef.requiresSize.w / 2);
        const fieldY = Math.max(0, clickY - toolDef.requiresSize.h / 2);

        const newField = {
            id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            signer_id: activeSignerId,
            field_type: tool,
            page_number: pageNumber,
            x: fieldX,
            y: fieldY,
            width: toolDef.requiresSize.w,
            height: toolDef.requiresSize.h,
            page_width: pageWidth,
            page_height: pageHeight,
            value: null,
            image_data: null,
            label: toolDef.label
        };
        setFields(prev => [...prev, newField]);
        if (activeSigner?.isMe && (tool === 'signature' || tool === 'initial')) {
            setActiveField(newField);
        }
        setTool('select');
    };

    const updateField = (fieldId, patch) => {
        setFields(prev => prev.map(f => f.id === fieldId ? { ...f, ...patch } : f));
    };

    const deleteField = (fieldId) => {
        setFields(prev => prev.filter(f => f.id !== fieldId));
        if (activeField?.id === fieldId) setActiveField(null);
    };

    const addSigner = (data) => {
        const newSigner = {
            id: `signer_${Date.now()}`,
            isMe: false,
            name: data.name,
            email: data.email,
            phone: data.phone || null,
            color: SIGNER_COLORS[signers.length % SIGNER_COLORS.length]
        };
        setSigners(prev => [...prev, newSigner]);
        setActiveSignerId(newSigner.id);
        setShowAddSigner(false);
    };

    const removeSigner = (signerId) => {
        if (signers.find(s => s.id === signerId)?.isMe) return;
        setSigners(prev => prev.filter(s => s.id !== signerId));
        setFields(prev => prev.filter(f => f.signer_id !== signerId));
        if (activeSignerId === signerId) setActiveSignerId('me');
    };

    const validate = () => {
        for (const signer of signers) {
            const sigFields = fieldsBySigner[signer.id] || [];
            if (sigFields.length === 0) {
                return `${signer.name} has no fields. Either remove this signer or add at least one field.`;
            }
            if (signer.isMe) {
                for (const f of sigFields) {
                    if ((f.field_type === 'signature' || f.field_type === 'initial') && !f.image_data) {
                        return `Your ${f.field_type} on page ${f.page_number} hasn't been drawn yet. Click it to sign.`;
                    }
                    if (f.field_type === 'date' && !f.value) {
                        updateField(f.id, { value: new Date().toLocaleDateString() });
                    }
                    if (f.field_type === 'text' && !f.value) {
                        return `Your text field on page ${f.page_number} is empty.`;
                    }
                }
            }
            if (!signer.isMe && !signer.email) {
                return `Signer ${signer.name} needs an email.`;
            }
        }
        return null;
    };

    const handleSend = async () => {
        const err = validate();
        if (err) { setSubmitError(err); return; }
        setSubmitError(null);
        setSending(true);

        try {
            const recipients = signers.map(signer => {
                const fs = fieldsBySigner[signer.id] || [];
                const out = {
                    email: signer.email,
                    name: signer.name,
                    phone: signer.phone || undefined,
                    message: message || undefined,
                    fields: fs.map((f, idx) => ({
                        field_type: f.field_type,
                        page_number: f.page_number,
                        x: f.x, y: f.y,
                        width: f.width, height: f.height,
                        page_width: f.page_width,
                        page_height: f.page_height,
                        label: f.label,
                        is_required: true,
                        sort_order: idx
                    }))
                };
                if (signer.isMe) {
                    out.auto_sign = true;
                    out.signed_fields = fs.map((f, idx) => ({
                        sort_order: idx,
                        value: f.value || null,
                        image_data: f.image_data || null
                    }));
                }
                return out;
            });

            const result = await signatures.createRequests({
                documentId: id,
                recipients,
                notify: { email: !signers.every(s => s.isMe), sms: false }
            });
            navigate(`/documents/${id}`, { state: { justSent: true, result } });
        } catch (err) {
            setSubmitError(err.response?.data?.error || err.message || 'Failed to send');
        } finally {
            setSending(false);
        }
    };

    if (loading) return <div className="editor-loading">Loading editor...</div>;
    if (error) return (
        <div className="editor-error">
            <h2>Can't open editor</h2>
            <p>{error}</p>
            <Link to={`/documents/${id}`} className="btn">Back to document</Link>
        </div>
    );

    return (
        <div className="editor">
            <header className="editor-header">
                <div className="editor-header-left">
                    <Link to={`/documents/${id}`} className="editor-back" title="Back">
                        <ToolIcon name="back" />
                    </Link>
                    <div>
                        <h1>{doc.title}</h1>
                        <p className="muted">{doc.document_type?.toUpperCase()} · {doc.page_count} page{doc.page_count === 1 ? '' : 's'} · Prepare for signatures</p>
                    </div>
                </div>
                <div className="editor-header-right">
                    <button onClick={() => navigate(`/documents/${id}`)} className="btn">Cancel</button>
                    <button onClick={handleSend} disabled={sending} className="btn btn-primary">
                        <ToolIcon name="send" />
                        {sending ? 'Sending...' : (signers.length === 1 && signers[0].isMe ? 'Finish & save' : `Send to ${signers.filter(s => !s.isMe).length} ${signers.filter(s => !s.isMe).length === 1 ? 'signer' : 'signers'}`)}
                    </button>
                </div>
            </header>

            {submitError && <div className="editor-error-banner">{submitError}</div>}

            <div className="editor-body">
                <aside className="editor-toolbar">
                    <p className="editor-toolbar-label">Adding for</p>
                    <div className="editor-signer-pill" style={{ '--signer-color': activeSigner.color }}>
                        <span className="dot" />
                        {activeSigner.name}{activeSigner.isMe && <span className="me-tag">You</span>}
                    </div>
                    <p className="editor-toolbar-label">Tools</p>
                    <div className="editor-tools">
                        {TOOLS.map(t => (
                            <button key={t.id}
                                onClick={() => setTool(t.id)}
                                className={`editor-tool ${tool === t.id ? 'active' : ''}`}
                                title={t.label}>
                                <ToolIcon name={t.icon} />
                                <span>{t.label}</span>
                            </button>
                        ))}
                    </div>
                    {tool !== 'select' && (
                        <div className="editor-tool-hint">
                            Click anywhere on the page to place a {TOOLS.find(t => t.id === tool)?.label.toLowerCase()}
                        </div>
                    )}
                </aside>

                <div className="editor-canvas">
                    {pages.map(page => (
                        <EditorPage
                            key={page.pageNumber}
                            page={page}
                            tool={tool}
                            fields={fields.filter(f => f.page_number === page.pageNumber)}
                            signers={signerById}
                            onPageClick={(e) => handlePageClick(page.pageNumber, page.width, page.height, e)}
                            onFieldClick={setActiveField}
                            onFieldDelete={deleteField}
                        />
                    ))}
                </div>

                <aside className="editor-signers">
                    <h3>Signers</h3>
                    <p className="muted">Pick who you're adding fields for, then choose a tool and click on the page.</p>
                    <div className="signer-list">
                        {signers.map(signer => (
                            <button key={signer.id}
                                onClick={() => setActiveSignerId(signer.id)}
                                className={`signer-card ${activeSignerId === signer.id ? 'active' : ''}`}
                                style={{ '--signer-color': signer.color }}>
                                <div className="signer-card-head">
                                    <span className="signer-avatar" style={{ background: signer.color }}>
                                        {signer.name.charAt(0).toUpperCase()}
                                    </span>
                                    <div>
                                        <strong>{signer.name}</strong>
                                        {signer.isMe && <span className="me-tag">You</span>}
                                        <small>{signer.email}</small>
                                    </div>
                                    {!signer.isMe && (
                                        <button onClick={(e) => { e.stopPropagation(); removeSigner(signer.id); }}
                                            className="signer-remove" title="Remove">
                                            <ToolIcon name="trash" />
                                        </button>
                                    )}
                                </div>
                                <div className="signer-stats">
                                    {(fieldsBySigner[signer.id] || []).length} field{(fieldsBySigner[signer.id] || []).length === 1 ? '' : 's'}
                                </div>
                            </button>
                        ))}
                    </div>
                    <button onClick={() => setShowAddSigner(true)} className="btn btn-add-signer">
                        <ToolIcon name="plus" /> Add signer
                    </button>

                    {signers.some(s => !s.isMe) && (
                        <>
                            <h3>Message to signers (optional)</h3>
                            <textarea value={message} onChange={e => setMessage(e.target.value)}
                                placeholder="e.g. Please review and sign by Friday."
                                rows={3} />
                        </>
                    )}
                </aside>
            </div>

            {activeField && (
                <FieldValueEditor
                    field={activeField}
                    signer={signerById[activeField.signer_id]}
                    onClose={() => setActiveField(null)}
                    onSave={(value, imageData) => {
                        updateField(activeField.id, { value, image_data: imageData });
                        setActiveField(null);
                    }}
                />
            )}

            {showAddSigner && (
                <AddSignerModal onClose={() => setShowAddSigner(false)} onAdd={addSigner} />
            )}
        </div>
    );
}

function EditorPage({ page, tool, fields, signers, onPageClick, onFieldClick, onFieldDelete }) {
    return (
        <div className={`editor-page ${tool !== 'select' ? 'placing' : ''}`}>
            <div className="editor-page-number">Page {page.pageNumber}</div>
            <div className="editor-page-canvas"
                 onClick={onPageClick}
                 style={{ aspectRatio: `${page.width} / ${page.height}` }}>
                {page.imageDataUrl
                    ? <img src={page.imageDataUrl} alt={`Page ${page.pageNumber}`} draggable={false} />
                    : <div className="editor-page-placeholder">No preview available for page {page.pageNumber}</div>
                }
                {fields.map(field => {
                    const signer = signers[field.signer_id] || { color: '#999', name: '?' };
                    const pctX = (field.x / field.page_width) * 100;
                    const pctY = (field.y / field.page_height) * 100;
                    const pctW = (field.width / field.page_width) * 100;
                    const pctH = (field.height / field.page_height) * 100;
                    return (
                        <div key={field.id}
                            className={`editor-field ${field.value || field.image_data ? 'filled' : 'empty'} field-${field.field_type}`}
                            style={{
                                left: `${pctX}%`, top: `${pctY}%`,
                                width: `${pctW}%`, height: `${pctH}%`,
                                '--field-color': signer.color
                            }}
                            onClick={(e) => { e.stopPropagation(); onFieldClick(field); }}>
                            <div className="editor-field-tag" style={{ background: signer.color }}>
                                {field.field_type === 'signature' ? '✎' :
                                 field.field_type === 'initial' ? 'i' :
                                 field.field_type === 'date' ? '📅' :
                                 field.field_type === 'checkbox' ? '☐' :
                                 field.field_type === 'note' ? '📝' : 'T'}
                            </div>
                            <div className="editor-field-content">
                                {field.image_data ? (
                                    <img src={field.image_data} alt="" />
                                ) : field.value ? (
                                    <span>{field.value}</span>
                                ) : (
                                    <span className="editor-field-hint">
                                        {field.field_type === 'signature' ? `Sign · ${signer.name}` :
                                         field.field_type === 'initial' ? `Initial · ${signer.name}` :
                                         field.field_type === 'date' ? 'Date' :
                                         field.field_type === 'text' ? 'Text' :
                                         field.field_type === 'note' ? 'Note' :
                                         'Check'}
                                    </span>
                                )}
                            </div>
                            <button className="editor-field-delete" title="Delete field"
                                onClick={(e) => { e.stopPropagation(); onFieldDelete(field.id); }}>
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function FieldValueEditor({ field, signer, onClose, onSave }) {
    const sigPad = useRef(null);
    const [value, setValue] = useState(field.value || '');

    const submitSignature = () => {
        if (!sigPad.current || sigPad.current.isEmpty()) {
            alert('Please draw a signature first');
            return;
        }
        onSave(signer?.name || value, sigPad.current.toDataURL('image/png'));
    };

    const submitDate = () => {
        const display = value || new Date().toLocaleDateString();
        onSave(display, null);
    };

    const submitText = () => {
        if (!value.trim()) {
            alert('Please enter some text');
            return;
        }
        onSave(value.trim(), null);
    };

    const submitCheckbox = () => onSave(value === 'true' ? 'true' : 'false', null);

    return (
        <div className="modal">
            <div className="modal-form editor-modal">
                <h2>
                    {field.field_type === 'signature' ? `Sign as ${signer?.name}` :
                     field.field_type === 'initial' ? `Initials for ${signer?.name}` :
                     field.field_type === 'date' ? 'Pick date' :
                     field.field_type === 'text' ? 'Enter text' :
                     field.field_type === 'note' ? 'Add note' :
                     'Checkbox'}
                </h2>

                {(field.field_type === 'signature' || field.field_type === 'initial') && (
                    <>
                        <div className="sig-canvas-wrapper">
                            <SignatureCanvas ref={sigPad}
                                canvasProps={{ width: 560, height: 200, className: 'sig-canvas' }}
                                penColor="rgb(15, 23, 80)" />
                        </div>
                        <p className="muted">Draw your {field.field_type} above using your mouse, trackpad or touchscreen.</p>
                        <div className="modal-actions">
                            <button onClick={() => sigPad.current?.clear()} className="btn">Clear</button>
                            <button onClick={onClose} className="btn">Cancel</button>
                            <button onClick={submitSignature} className="btn btn-primary">Apply</button>
                        </div>
                    </>
                )}

                {field.field_type === 'date' && (
                    <>
                        <input type="date" value={value} onChange={e => setValue(e.target.value)} />
                        <div className="modal-actions">
                            <button onClick={onClose} className="btn">Cancel</button>
                            <button onClick={submitDate} className="btn btn-primary">Apply</button>
                        </div>
                    </>
                )}

                {(field.field_type === 'text' || field.field_type === 'note') && (
                    <>
                        {field.field_type === 'note'
                            ? <textarea value={value} onChange={e => setValue(e.target.value)}
                                placeholder="Type your note..." rows={4} autoFocus />
                            : <input type="text" value={value} onChange={e => setValue(e.target.value)}
                                placeholder="Type text..." autoFocus />}
                        <div className="modal-actions">
                            <button onClick={onClose} className="btn">Cancel</button>
                            <button onClick={submitText} className="btn btn-primary">Apply</button>
                        </div>
                    </>
                )}

                {field.field_type === 'checkbox' && (
                    <>
                        <label className="checkbox">
                            <input type="checkbox"
                                checked={value === 'true'}
                                onChange={e => setValue(e.target.checked ? 'true' : 'false')} />
                            I agree / confirm
                        </label>
                        <div className="modal-actions">
                            <button onClick={onClose} className="btn">Cancel</button>
                            <button onClick={submitCheckbox} className="btn btn-primary">Apply</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function AddSignerModal({ onClose, onAdd }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');

    const submit = (e) => {
        e.preventDefault();
        if (!name.trim() || !email.trim()) return;
        onAdd({ name: name.trim(), email: email.trim(), phone: phone.trim() || null });
    };

    return (
        <div className="modal">
            <form onSubmit={submit} className="modal-form">
                <h2>Add a signer</h2>
                <label>Full name
                    <input value={name} onChange={e => setName(e.target.value)}
                        required autoFocus placeholder="e.g. Bob Recipient" />
                </label>
                <label>Email
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                        required placeholder="signer@example.com" />
                </label>
                <label>Phone (optional, E.164)
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                        pattern="^\+[1-9]\d{6,14}$" placeholder="+15551234567" />
                </label>
                <div className="modal-actions">
                    <button type="button" onClick={onClose} className="btn">Cancel</button>
                    <button type="submit" className="btn btn-primary">Add signer</button>
                </div>
            </form>
        </div>
    );
}

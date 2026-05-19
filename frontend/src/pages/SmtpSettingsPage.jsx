import React, { useEffect, useState } from 'react';
import { smtp } from '../services/api.js';

export default function SmtpSettingsPage() {
    const [configs, setConfigs] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [loading, setLoading] = useState(true);

    const refresh = async () => {
        setLoading(true);
        try {
            const data = await smtp.list();
            setConfigs(data.configurations || []);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { refresh(); }, []);

    return (
        <div className="page">
            <div className="page-header">
                <h1>SMTP Configuration</h1>
                <button onClick={() => setShowForm(true)} className="btn btn-primary">
                    Add Configuration
                </button>
            </div>

            <p className="muted">
                Configure your own SMTP server to send signature request emails. Your credentials
                are encrypted at rest. Recommended providers: Gmail (with app password), SendGrid,
                AWS SES, Postmark.
            </p>

            {loading && <p>Loading...</p>}
            {!loading && configs.length === 0 && (
                <p className="empty">No SMTP configurations yet. Add one to send emails from your own server.</p>
            )}

            <div className="config-list">
                {configs.map(c => (
                    <SmtpCard key={c.id} config={c} onUpdated={refresh} />
                ))}
            </div>

            {showForm && (
                <SmtpForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refresh(); }} />
            )}
        </div>
    );
}

function SmtpCard({ config, onUpdated }) {
    const [testEmail, setTestEmail] = useState('');
    const [testing, setTesting] = useState(false);
    const [message, setMessage] = useState(null);

    const test = async () => {
        if (!testEmail) return;
        setTesting(true);
        setMessage(null);
        try {
            await smtp.test(config.id, testEmail);
            setMessage({ type: 'success', text: `Test email sent to ${testEmail}` });
            onUpdated();
        } catch (err) {
            setMessage({ type: 'error', text: err.response?.data?.error || 'Test failed' });
        } finally {
            setTesting(false);
        }
    };

    const remove = async () => {
        if (!confirm(`Delete SMTP configuration "${config.name}"?`)) return;
        await smtp.delete(config.id);
        onUpdated();
    };

    const setDefault = async () => {
        await smtp.setDefault(config.id);
        onUpdated();
    };

    return (
        <div className="card">
            <h3>{config.name} {config.is_default && <span className="tag">Default</span>}</h3>
            <p className="muted">{config.host}:{config.port} - {config.from_address}</p>
            <p className={config.is_verified ? 'success' : 'warning'}>
                {config.is_verified ? '✓ Verified' : '⚠ Not verified'}
            </p>
            <div className="actions">
                <input type="email" placeholder="test@example.com"
                    value={testEmail} onChange={e => setTestEmail(e.target.value)} />
                <button onClick={test} disabled={testing} className="btn">
                    {testing ? 'Testing...' : 'Send test'}
                </button>
                {!config.is_default && <button onClick={setDefault} className="btn">Set as default</button>}
                <button onClick={remove} className="btn btn-danger">Delete</button>
            </div>
            {message && <div className={`message ${message.type}`}>{message.text}</div>}
        </div>
    );
}

function SmtpForm({ onClose, onSaved }) {
    const [form, setForm] = useState({
        name: 'Default', host: 'smtp.gmail.com', port: 587, secure: false,
        username: '', password: '', from_name: '', from_address: '',
        reply_to: '', is_default: true, verify: true
    });
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const change = (k) => (e) => {
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        setForm(f => ({ ...f, [k]: v }));
    };

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        setSaving(true);
        try {
            await smtp.create({ ...form, port: parseInt(form.port, 10) });
            onSaved();
        } catch (err) {
            setError(err.response?.data?.details || err.response?.data?.error || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal">
            <form onSubmit={submit} className="modal-form">
                <h2>SMTP Configuration</h2>
                <label>Name <input value={form.name} onChange={change('name')} /></label>
                <div className="row">
                    <label>Host <input value={form.host} onChange={change('host')} required /></label>
                    <label>Port <input type="number" value={form.port} onChange={change('port')} required /></label>
                </div>
                <label className="checkbox">
                    <input type="checkbox" checked={form.secure} onChange={change('secure')} />
                    Use TLS/SSL (typically port 465)
                </label>
                <label>Username <input value={form.username} onChange={change('username')} required autoComplete="off" /></label>
                <label>Password <input type="password" value={form.password} onChange={change('password')} required autoComplete="new-password" /></label>
                <div className="row">
                    <label>From name <input value={form.from_name} onChange={change('from_name')} required /></label>
                    <label>From email <input type="email" value={form.from_address} onChange={change('from_address')} required /></label>
                </div>
                <label>Reply-to (optional) <input type="email" value={form.reply_to} onChange={change('reply_to')} /></label>
                <label className="checkbox">
                    <input type="checkbox" checked={form.verify} onChange={change('verify')} />
                    Verify SMTP connection before saving
                </label>
                <label className="checkbox">
                    <input type="checkbox" checked={form.is_default} onChange={change('is_default')} />
                    Set as default
                </label>
                {error && <div className="error">{typeof error === 'string' ? error : JSON.stringify(error)}</div>}
                <div className="modal-actions">
                    <button type="button" onClick={onClose} className="btn">Cancel</button>
                    <button type="submit" disabled={saving} className="btn btn-primary">
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </form>
        </div>
    );
}

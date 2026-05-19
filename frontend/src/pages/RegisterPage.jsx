import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../services/auth.jsx';

export default function RegisterPage() {
    const { register } = useAuth();
    const [form, setForm] = useState({
        email: '', password: '', full_name: '', phone_number: ''
    });
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const onSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const payload = { ...form };
            if (!payload.phone_number) delete payload.phone_number;
            await register(payload);
        } catch (err) {
            setError(err.response?.data?.error
                || err.response?.data?.details?.[0]?.message
                || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    const change = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

    return (
        <div className="auth-page">
            <div className="auth-card">
                <h1>Create your SignPro account</h1>
                <form onSubmit={onSubmit}>
                    <label>Full name
                        <input type="text" value={form.full_name}
                            onChange={change('full_name')} required minLength={2} />
                    </label>
                    <label>Email
                        <input type="email" value={form.email}
                            onChange={change('email')} required autoComplete="email" />
                    </label>
                    <label>Phone (optional, E.164)
                        <input type="tel" value={form.phone_number}
                            onChange={change('phone_number')}
                            placeholder="+15551234567" pattern="^\+[1-9]\d{6,14}$" />
                    </label>
                    <label>Password (min 10 characters)
                        <input type="password" value={form.password}
                            onChange={change('password')}
                            required minLength={10} autoComplete="new-password" />
                    </label>
                    {error && <div className="error">{error}</div>}
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Creating...' : 'Create account'}
                    </button>
                </form>
                <p>Already have an account? <Link to="/login">Sign in</Link></p>
            </div>
        </div>
    );
}

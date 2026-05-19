import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../services/auth.jsx';

export default function LoginPage() {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const onSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login(email, password);
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <h1>Sign in to SignPro</h1>
                <form onSubmit={onSubmit}>
                    <label>Email
                        <input type="email" value={email}
                            onChange={e => setEmail(e.target.value)}
                            required autoComplete="email" />
                    </label>
                    <label>Password
                        <input type="password" value={password}
                            onChange={e => setPassword(e.target.value)}
                            required autoComplete="current-password" />
                    </label>
                    {error && <div className="error">{error}</div>}
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Signing in...' : 'Sign in'}
                    </button>
                </form>
                <p>Don't have an account? <Link to="/register">Create one</Link></p>
            </div>
        </div>
    );
}

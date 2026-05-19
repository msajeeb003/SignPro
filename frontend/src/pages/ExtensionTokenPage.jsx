import React, { useState } from 'react';
import { auth } from '../services/api.js';

export default function ExtensionTokenPage() {
    const [token, setToken] = useState(null);
    const [tokenInfo, setTokenInfo] = useState(null);
    const [name, setName] = useState('My Browser Extension');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const generate = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await auth.createExtensionToken(name);
            setToken(result.token);
            setTokenInfo(result.tokenInfo);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to generate token');
        } finally {
            setLoading(false);
        }
    };

    const copyToken = () => {
        if (!token) return;
        navigator.clipboard.writeText(token);
    };

    return (
        <div className="page">
            <h1>Browser Extension</h1>
            <p className="muted">
                Generate a long-lived token for the SignPro browser extension to receive real-time
                notifications about your signature requests.
            </p>

            <section className="section">
                <h2>Generate Extension Token</h2>
                <p className="muted">
                    Tokens are valid for 90 days and grant access to your pending signature
                    requests and notification feed. Treat them like passwords.
                </p>
                <div className="row">
                    <label style={{ flex: 1 }}>Token name
                        <input value={name} onChange={e => setName(e.target.value)} />
                    </label>
                    <button onClick={generate} disabled={loading} className="btn btn-primary">
                        {loading ? 'Generating...' : 'Generate Token'}
                    </button>
                </div>
                {error && <div className="error">{error}</div>}

                {token && (
                    <div className="token-display">
                        <h3>⚠ Save this token now - it won't be shown again</h3>
                        <code className="token">{token}</code>
                        <div className="actions">
                            <button onClick={copyToken} className="btn">Copy to clipboard</button>
                        </div>
                        {tokenInfo && (
                            <p className="muted">
                                Expires: {new Date(tokenInfo.expires_at).toLocaleString()}
                            </p>
                        )}
                    </div>
                )}
            </section>

            <section className="section">
                <h2>Install the Extension</h2>
                <ol>
                    <li>Open Chrome and go to <code>chrome://extensions</code>.</li>
                    <li>Enable "Developer mode" in the top-right.</li>
                    <li>Click "Load unpacked" and select the <code>extension/</code> folder.</li>
                    <li>Click the SignPro icon in your toolbar → Settings.</li>
                    <li>Enter your API URL, frontend URL, and paste the token above.</li>
                    <li>Click "Connect" - you should see a success message.</li>
                </ol>
            </section>
        </div>
    );
}

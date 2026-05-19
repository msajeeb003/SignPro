import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { documents } from '../services/api.js';

const STATUS_LABELS = {
    uploaded: 'Uploaded',
    parsing: 'Processing',
    ready: 'Ready to send',
    sent: 'Awaiting signatures',
    partially_signed: 'Partially signed',
    completed: 'Completed',
    declined: 'Declined',
    expired: 'Expired',
    voided: 'Voided',
    failed: 'Failed'
};

export default function DashboardPage() {
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [statusFilter, setStatusFilter] = useState('');

    const refresh = async () => {
        setLoading(true);
        try {
            const data = await documents.list({ status: statusFilter || undefined });
            setDocs(data.documents || []);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load documents');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { refresh(); }, [statusFilter]);

    return (
        <div className="page">
            <div className="page-header">
                <h1>Documents</h1>
                <Link to="/upload" className="btn btn-primary">Upload Document</Link>
            </div>

            <div className="filters">
                <label>Status
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                        <option value="">All</option>
                        {Object.entries(STATUS_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                        ))}
                    </select>
                </label>
            </div>

            {loading && <p>Loading...</p>}
            {error && <div className="error">{error}</div>}
            {!loading && docs.length === 0 && (
                <div className="empty">
                    <p>No documents yet.</p>
                    <Link to="/upload" className="btn btn-primary">Upload your first document</Link>
                </div>
            )}

            {docs.length > 0 && (
                <table className="table">
                    <thead>
                        <tr>
                            <th>Title</th>
                            <th>Type</th>
                            <th>Pages</th>
                            <th>Status</th>
                            <th>Signatures</th>
                            <th>Created</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {docs.map(d => (
                            <tr key={d.id}>
                                <td><Link to={`/documents/${d.id}`}>{d.title}</Link></td>
                                <td>{d.document_type?.toUpperCase()}</td>
                                <td>{d.page_count ?? '-'}</td>
                                <td>
                                    <span className={`status status-${d.status}`}>
                                        {STATUS_LABELS[d.status] || d.status}
                                    </span>
                                </td>
                                <td>{d.signed_count}/{d.signature_count}</td>
                                <td>{new Date(d.created_at).toLocaleDateString()}</td>
                                <td><Link to={`/documents/${d.id}`}>Open →</Link></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

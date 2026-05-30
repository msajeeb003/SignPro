import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { documents } from '../services/api.js';

const STATUS_META = {
    uploaded: { label: 'Uploaded', group: 'progress', action: 'Open' },
    parsing: { label: 'Processing', group: 'progress', action: 'Open' },
    ready: { label: 'Ready to send', group: 'todo', action: 'Send for signature' },
    sent: { label: 'Waiting for signature', group: 'todo', action: 'Manage signatures' },
    partially_signed: { label: 'Partially signed', group: 'todo', action: 'Manage signatures' },
    completed: { label: 'Completed', group: 'done', action: 'View / Download' },
    declined: { label: 'Declined', group: 'done', action: 'View' },
    expired: { label: 'Expired', group: 'done', action: 'View' },
    voided: { label: 'Voided', group: 'done', action: 'View' },
    failed: { label: 'Failed to parse', group: 'progress', action: 'Retry' }
};

const STATUS_DOT_CLASS = {
    todo: 'dot-amber',
    progress: 'dot-blue',
    done: 'dot-green'
};

export default function DashboardPage() {
    const [params] = useSearchParams();
    const query = params.get('q')?.toLowerCase() || '';
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [view, setView] = useState('grid');

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const data = await documents.list({ limit: 100 });
                setDocs(data.documents || []);
            } catch (err) {
                setError(err.response?.data?.error || 'Failed to load documents');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const filtered = useMemo(() => {
        if (!query) return docs;
        return docs.filter(d => d.title?.toLowerCase().includes(query));
    }, [docs, query]);

    const groups = useMemo(() => {
        const buckets = { todo: [], progress: [], done: [] };
        for (const d of filtered) {
            const meta = STATUS_META[d.status] || { group: 'progress' };
            (buckets[meta.group] || buckets.progress).push(d);
        }
        return buckets;
    }, [filtered]);

    return (
        <div className="dash">
            <header className="dash-hero">
                <div>
                    <h1>Welcome back</h1>
                    <p className="dash-membership">
                        <span className="brand-mark">SignPro</span> <strong>Essentials</strong> Membership
                    </p>
                </div>
                <Link to="/upload" className="btn btn-primary btn-pill">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Start new
                </Link>
            </header>

            {query && (
                <div className="dash-search-pill">
                    Showing results for <strong>"{query}"</strong>
                    <Link to="/dashboard">Clear</Link>
                </div>
            )}

            {error && <div className="error">{error}</div>}
            {loading && <div className="loading">Loading documents...</div>}

            {!loading && (
                <>
                    <Section
                        title="To Do"
                        count={groups.todo.length}
                        view={view}
                        onViewChange={setView}
                        emptyText="Nothing waiting on you right now."
                    >
                        {groups.todo.length === 0 && <NoticeCard message="You're all caught up!" />}
                        {groups.todo.map(d => <DocCard key={d.id} doc={d} />)}
                    </Section>

                    <Section title="In Progress" count={groups.progress.length}>
                        {groups.progress.length === 0 && <NoticeCard message="No drafts in progress." />}
                        {groups.progress.map(d => <DocCard key={d.id} doc={d} />)}
                    </Section>

                    <Section title="Completed" count={groups.done.length} compact>
                        {groups.done.length === 0 && <NoticeCard message="No completed documents yet." />}
                        {groups.done.map(d => <DocCard key={d.id} doc={d} />)}
                    </Section>
                </>
            )}
        </div>
    );
}

function Section({ title, count, children, view, onViewChange, compact }) {
    return (
        <section className={`dash-section ${compact ? 'compact' : ''}`}>
            <div className="dash-section-head">
                <h2>{title} <span className="dash-section-count">({count})</span></h2>
                {onViewChange && (
                    <div className="dash-view-toggle" role="group">
                        <button onClick={() => onViewChange('grid')}
                            className={view === 'grid' ? 'active' : ''} aria-label="Grid view">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                                <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                            </svg>
                        </button>
                        <button onClick={() => onViewChange('list')}
                            className={view === 'list' ? 'active' : ''} aria-label="List view">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                                <line x1="8" y1="18" x2="21" y2="18"/>
                                <circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>
                            </svg>
                        </button>
                    </div>
                )}
            </div>
            <div className={`dash-cards ${view === 'list' ? 'as-list' : ''}`}>
                {children}
            </div>
        </section>
    );
}

function DocCard({ doc }) {
    const meta = STATUS_META[doc.status] || { label: doc.status, group: 'progress', action: 'Open' };
    const updated = new Date(doc.updated_at || doc.created_at);
    return (
        <Link to={`/documents/${doc.id}`} className={`doc-card group-${meta.group}`}>
            <div className="doc-card-head">
                <span className="doc-card-updated">
                    Updated on {updated.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' })}
                </span>
                <button className="doc-card-menu" onClick={(e) => e.preventDefault()} aria-label="More">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                    </svg>
                </button>
            </div>
            <div className="doc-card-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span>{doc.title}</span>
            </div>
            <div className="doc-card-status">
                <span className={`status-dot ${STATUS_DOT_CLASS[meta.group]}`}></span>
                {meta.label}
            </div>
            <div className="doc-card-preview">
                <DocThumbnail title={doc.title} type={doc.document_type} status={doc.status} pages={doc.page_count} />
            </div>
            <div className="doc-card-action">
                <span>{meta.action}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M5 12h14M13 5l7 7-7 7"/>
                </svg>
            </div>
        </Link>
    );
}

function DocThumbnail({ title, type, status, pages }) {
    const initials = (title || 'Doc').toUpperCase().slice(0, 30);
    return (
        <div className="thumb">
            <div className="thumb-paper">
                <div className="thumb-lines">
                    <div className="thumb-line title">{initials}</div>
                    <div className="thumb-line short"></div>
                    <div className="thumb-line"></div>
                    <div className="thumb-line"></div>
                    <div className="thumb-line med"></div>
                    <div className="thumb-line"></div>
                    <div className="thumb-line short"></div>
                </div>
                {status === 'completed' && (
                    <div className="thumb-stamp">SIGNED</div>
                )}
            </div>
            <div className="thumb-foot">
                <span className="thumb-type">{type?.toUpperCase()}</span>
                {pages != null && <span className="thumb-pages">{pages} pg</span>}
            </div>
        </div>
    );
}

function NoticeCard({ message }) {
    return (
        <div className="notice-card">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>
            </svg>
            <p>{message}</p>
        </div>
    );
}

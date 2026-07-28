import React, { useState } from 'react';
import { Routes, Route, Navigate, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './services/auth.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import DocumentDetailPage from './pages/DocumentDetailPage.jsx';
import DocumentEditorPage from './pages/DocumentEditorPage.jsx';
import SmtpSettingsPage from './pages/SmtpSettingsPage.jsx';
import ExtensionTokenPage from './pages/ExtensionTokenPage.jsx';
import SignPage from './pages/SignPage.jsx';
import NdaPage from './pages/NdaPage.jsx';
import ThemeSwitcher from './components/ThemeSwitcher.jsx';

// No ProtectedRoute needed — auth is handled by the parent Next.js app

const NAV_ITEMS = [
    { to: '/dashboard',  label: 'Home',                   icon: 'home' },
    { to: '/nda',        label: 'Send NDA',                icon: 'pen' },
    { to: '/templates',  label: 'Make documents',          icon: 'docs' },
    { to: '/upload',     label: 'Upload documents',        icon: 'upload' },
    { to: '/legal-pro',  label: 'Connect with a Legal Pro',icon: 'user' },
    { to: '/business',   label: 'Start a business',        icon: 'briefcase' },
    { to: '/resources',  label: 'Legal resources',         icon: 'book' },
    { to: '/settings/smtp',      label: 'SMTP settings',   icon: 'mail' },
    { to: '/settings/extension', label: 'Browser extension',icon: 'puzzle' },
];

function Icon({ name }) {
    const icons = {
        home:     <path d="M3 12L12 3l9 9M5 10v10a1 1 0 001 1h3v-7h6v7h3a1 1 0 001-1V10"/>,
        pen:      <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
        docs:     <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></>,
        upload:   <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
        user:     <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
        briefcase:<><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></>,
        book:     <><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></>,
        mail:     <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
        puzzle:   <path d="M19.43 12.98l-1.21.2a7.6 7.6 0 01-.43 1.05l.79.94a1 1 0 010 1.41l-1.83 1.83a1 1 0 01-1.41 0l-.94-.79a7.6 7.6 0 01-1.05.43l-.2 1.21a1 1 0 01-.99.83h-2.59a1 1 0 01-.99-.83l-.2-1.21a7.6 7.6 0 01-1.05-.43l-.94.79a1 1 0 01-1.41 0L4.6 16.58a1 1 0 010-1.41l.79-.94a7.6 7.6 0 01-.43-1.05l-1.21-.2A1 1 0 013 11.99V9.4a1 1 0 01.83-.99l1.21-.2c.11-.36.26-.71.43-1.05l-.79-.94a1 1 0 010-1.41L6.51 2.98a1 1 0 011.41 0l.94.79c.34-.17.69-.32 1.05-.43l.2-1.21A1 1 0 0111.1 1.3h2.59a1 1 0 01.99.83l.2 1.21c.36.11.71.26 1.05.43l.94-.79a1 1 0 011.41 0l1.83 1.83a1 1 0 010 1.41l-.79.94c.17.34.32.69.43 1.05l1.21.2a1 1 0 01.83.99v2.59a1 1 0 01-.83.99z"/>,
        search:   <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
        help:     <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
        plus:     <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
        logout:   <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    };
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {icons[name]}
        </svg>
    );
}

function Sidebar() {
    return (
        <aside className="sidebar">
            <Link to="/dashboard" className="sidebar-brand">
                <span className="sidebar-brand-mark"></span>
                <span className="sidebar-brand-text">Sign<strong>Pro</strong></span>
            </Link>
            <nav className="sidebar-nav">
                {NAV_ITEMS.map(item => (
                    <NavLink key={item.to} to={item.to}
                        className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        <Icon name={item.icon} />
                        <span>{item.label}</span>
                        {item.to === '/nda' && <span className="sidebar-link-badge">NDA</span>}
                    </NavLink>
                ))}
            </nav>
            <div className="sidebar-promo">
                <p className="sidebar-promo-title">SignPro AI Insights</p>
                <p className="sidebar-promo-body">
                    Surface contract red flags, key dates, and obligations in seconds.
                </p>
                <button className="sidebar-promo-btn">Try AI Insights</button>
            </div>
        </aside>
    );
}

function TopBar() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [q, setQ] = useState('');
    const submitSearch = (e) => {
        e.preventDefault();
        navigate(`/dashboard?q=${encodeURIComponent(q)}`);
    };
    return (
        <header className="topbar">
            <form className="topbar-search" onSubmit={submitSearch}>
                <Icon name="search" />
                <input type="search" value={q} onChange={e => setQ(e.target.value)}
                    placeholder="Search documents, templates, or signers..." />
            </form>
            <div className="topbar-actions">
                <ThemeSwitcher />
                <button className="topbar-help" title="Help" aria-label="Help">
                    <Icon name="help" />
                    <span>Help</span>
                </button>
                <Link to="/nda" className="topbar-cta">
                    <Icon name="pen" />
                    Send NDA
                </Link>
                <div className="topbar-user">
                    <span className="topbar-user-name">{user?.full_name || user?.email}</span>
                    <span className="topbar-avatar" aria-hidden="true">
                        {(user?.full_name || user?.email || '?').charAt(0).toUpperCase()}
                    </span>
                </div>
            </div>
        </header>
    );
}

function Layout({ children }) {
    const location = useLocation();
    const isSignPage = location.pathname.startsWith('/sign/');
    if (isSignPage) return <>{children}</>;
    return (
        <div className="app-shell">
            <Sidebar />
            <div className="app-shell-main">
                <TopBar />
                <main className="app-content">{children}</main>
            </div>
        </div>
    );
}

function PlaceholderPage({ title, description, eyebrow }) {
    return (
        <div className="placeholder-page">
            {eyebrow && <span className="placeholder-eyebrow">{eyebrow}</span>}
            <h1>{title}</h1>
            <p>{description}</p>
            <Link to="/dashboard" className="btn btn-primary">Back to Home</Link>
        </div>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <Layout>
                <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/sign/:token" element={<SignPage />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/nda" element={<NdaPage />} />
                    <Route path="/upload" element={<UploadPage />} />
                    <Route path="/documents/:id" element={<DocumentDetailPage />} />
                    <Route path="/documents/:id/edit" element={<DocumentEditorPage />} />
                    <Route path="/settings/smtp" element={<SmtpSettingsPage />} />
                    <Route path="/settings/extension" element={<ExtensionTokenPage />} />
                    <Route path="/templates" element={
                        <PlaceholderPage eyebrow="Coming soon"
                            title="Make documents from templates"
                            description="A library of NDAs, leases, employment contracts, and more is coming soon. For now, use the NDA feature to send your pre-built NDA." />
                    } />
                    <Route path="/legal-pro" element={
                        <PlaceholderPage eyebrow="Coming soon"
                            title="Connect with a Legal Pro"
                            description="Get on-demand legal advice from a vetted attorney. Subscriptions launch later this year." />
                    } />
                    <Route path="/business" element={
                        <PlaceholderPage eyebrow="Coming soon"
                            title="Start a business"
                            description="LLC and incorporation services with registered-agent support are on the roadmap." />
                    } />
                    <Route path="/resources" element={
                        <PlaceholderPage eyebrow="Knowledge base"
                            title="Legal resources"
                            description="Guides, FAQs, and best-practice articles for using electronic signatures legally and securely." />
                    } />
                    {/* Catch-all redirect */}
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
            </Layout>
        </AuthProvider>
    );
}

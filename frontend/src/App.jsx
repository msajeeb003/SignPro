import React from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './services/auth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import DocumentDetailPage from './pages/DocumentDetailPage.jsx';
import SmtpSettingsPage from './pages/SmtpSettingsPage.jsx';
import ExtensionTokenPage from './pages/ExtensionTokenPage.jsx';
import SignPage from './pages/SignPage.jsx';

function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading) return <div className="loading">Loading...</div>;
    if (!user) return <Navigate to="/login" replace />;
    return children;
}

function Layout({ children }) {
    const { user, logout } = useAuth();
    const location = useLocation();
    if (location.pathname.startsWith('/sign/')) return <>{children}</>;

    return (
        <div className="app-layout">
            {user && (
                <nav className="nav">
                    <div className="nav-brand">
                        <Link to="/dashboard">SignPro</Link>
                    </div>
                    <div className="nav-links">
                        <Link to="/dashboard">Documents</Link>
                        <Link to="/upload">Upload</Link>
                        <Link to="/settings/smtp">SMTP</Link>
                        <Link to="/settings/extension">Extension</Link>
                    </div>
                    <div className="nav-user">
                        <span>{user.email}</span>
                        <button onClick={logout} className="btn-link">Sign out</button>
                    </div>
                </nav>
            )}
            <main className="main-content">{children}</main>
        </div>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <Layout>
                <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/sign/:token" element={<SignPage />} />
                    <Route path="/dashboard" element={
                        <ProtectedRoute><DashboardPage /></ProtectedRoute>
                    } />
                    <Route path="/upload" element={
                        <ProtectedRoute><UploadPage /></ProtectedRoute>
                    } />
                    <Route path="/documents/:id" element={
                        <ProtectedRoute><DocumentDetailPage /></ProtectedRoute>
                    } />
                    <Route path="/settings/smtp" element={
                        <ProtectedRoute><SmtpSettingsPage /></ProtectedRoute>
                    } />
                    <Route path="/settings/extension" element={
                        <ProtectedRoute><ExtensionTokenPage /></ProtectedRoute>
                    } />
                </Routes>
            </Layout>
        </AuthProvider>
    );
}

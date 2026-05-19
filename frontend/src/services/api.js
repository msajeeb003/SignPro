import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
    baseURL: API_BASE || '/',
    headers: { 'Content-Type': 'application/json' }
});

const ACCESS_KEY = 'signpro_access_token';
const REFRESH_KEY = 'signpro_refresh_token';

export function setTokens({ accessToken, refreshToken }) {
    if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
}

export function getAccessToken() {
    return localStorage.getItem(ACCESS_KEY);
}

api.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

let refreshPromise = null;

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const original = error.config;
        if (error.response?.status === 401 && !original._retried) {
            const refreshToken = localStorage.getItem(REFRESH_KEY);
            if (!refreshToken) {
                clearTokens();
                throw error;
            }
            original._retried = true;
            try {
                if (!refreshPromise) {
                    refreshPromise = axios.post(`${API_BASE}/api/auth/refresh`, { refreshToken });
                }
                const { data } = await refreshPromise;
                refreshPromise = null;
                setTokens({ accessToken: data.accessToken });
                original.headers.Authorization = `Bearer ${data.accessToken}`;
                return api(original);
            } catch (refreshError) {
                refreshPromise = null;
                clearTokens();
                window.location.href = '/login';
                throw refreshError;
            }
        }
        throw error;
    }
);

export const auth = {
    register: (data) => api.post('/api/auth/register', data).then(r => r.data),
    login: (data) => api.post('/api/auth/login', data).then(r => r.data),
    logout: (refreshToken) => api.post('/api/auth/logout', { refreshToken }).then(r => r.data),
    me: () => api.get('/api/auth/me').then(r => r.data),
    createExtensionToken: (name) => api.post('/api/auth/extension-token', { name }).then(r => r.data),
    revokeExtensionToken: (id) => api.delete(`/api/auth/extension-token/${id}`).then(r => r.data)
};

export const documents = {
    upload: (file, options = {}) => {
        const fd = new FormData();
        fd.append('document', file);
        if (options.title) fd.append('title', options.title);
        if (options.description) fd.append('description', options.description);
        return api.post('/api/documents/upload', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: options.onProgress
        }).then(r => r.data);
    },
    list: (params) => api.get('/api/documents', { params }).then(r => r.data),
    get: (id) => api.get(`/api/documents/${id}`).then(r => r.data),
    getPages: (id) => api.get(`/api/documents/${id}/pages`).then(r => r.data),
    parse: (id) => api.post(`/api/documents/${id}/parse`).then(r => r.data),
    delete: (id) => api.delete(`/api/documents/${id}`).then(r => r.data),
    download: (id, variant = 'signed') => {
        return api.get(`/api/documents/${id}/download`, {
            params: { variant }, responseType: 'blob'
        });
    },
    history: (id) => api.get(`/api/documents/${id}/history`).then(r => r.data)
};

export const signatures = {
    createRequests: (data) => api.post('/api/signatures/requests', data).then(r => r.data),
    getSession: (token) => api.get(`/api/signatures/session/${token}`).then(r => r.data),
    getSessionPages: (token) => api.get(`/api/signatures/session/${token}/pages`).then(r => r.data),
    complete: (token, data) => api.post(`/api/signatures/session/${token}/complete`, data).then(r => r.data),
    decline: (token, reason) => api.post(`/api/signatures/session/${token}/decline`, { reason }).then(r => r.data),
    resend: (id, options = {}) => api.post(`/api/signatures/${id}/resend`, options).then(r => r.data),
    cancel: (id) => api.delete(`/api/signatures/${id}`).then(r => r.data),
    verify: (data) => api.post('/api/signatures/verify', data).then(r => r.data)
};

export const smtp = {
    list: () => api.get('/api/smtp').then(r => r.data),
    create: (data) => api.post('/api/smtp', data).then(r => r.data),
    update: (id, data) => api.put(`/api/smtp/${id}`, data).then(r => r.data),
    test: (id, to) => api.post(`/api/smtp/${id}/test`, { to }).then(r => r.data),
    setDefault: (id) => api.post(`/api/smtp/${id}/set-default`).then(r => r.data),
    delete: (id) => api.delete(`/api/smtp/${id}`).then(r => r.data)
};

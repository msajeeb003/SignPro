import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth as authApi, setTokens, clearTokens, getAccessToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        (async () => {
            if (!getAccessToken()) {
                setLoading(false);
                return;
            }
            try {
                const me = await authApi.me();
                setUser(me);
            } catch {
                clearTokens();
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const login = async (email, password) => {
        const result = await authApi.login({ email, password });
        setTokens(result);
        setUser(result.user);
        navigate('/dashboard');
        return result;
    };

    const register = async (data) => {
        const result = await authApi.register(data);
        setTokens(result);
        setUser(result.user);
        navigate('/dashboard');
        return result;
    };

    const logout = async () => {
        try { await authApi.logout(localStorage.getItem('signpro_refresh_token')); } catch {}
        clearTokens();
        setUser(null);
        navigate('/login');
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);

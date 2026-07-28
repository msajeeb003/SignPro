import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

// Mocked agency owner - no login required since this is a feature in your main webapp
const AGENCY_USER = {
    id: 'agency-owner-1',
    full_name: 'Agency Owner',
    email: 'admin@myagency.com',
    role: 'owner',
    agency_name: 'My Agency'
};

export function AuthProvider({ children }) {
    const [user] = useState(AGENCY_USER);
    const [loading] = useState(false);

    // These are no-ops in embedded mode; auth is handled by the parent Next.js app
    const login = async () => user;
    const register = async () => user;
    const logout = () => {};

    return (
        <AuthContext.Provider value={{ user, loading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);

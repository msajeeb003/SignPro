import React, { useEffect, useState } from 'react';

export default function ThemeSwitcher() {
    const [theme, setTheme] = useState(() => {
        return localStorage.getItem('signpro-theme') || 'default';
    });

    useEffect(() => {
        if (theme === 'luxe') {
            document.documentElement.setAttribute('data-theme', 'luxe');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        localStorage.setItem('signpro-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'default' ? 'luxe' : 'default');
    };

    return (
        <button 
            onClick={toggleTheme} 
            className="btn btn-link" 
            title="Toggle Theme"
            style={{ padding: '0 8px' }}
        >
            {theme === 'default' ? '✨ Switch to Luxe' : '🔄 Switch to Utility'}
        </button>
    );
}

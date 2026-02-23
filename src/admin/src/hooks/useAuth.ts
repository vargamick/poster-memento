import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import React from 'react';
import { getApiKey } from '../api/client';

interface AuthContextValue {
  apiKey: string;
  setApiKey: (key: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState(() => getApiKey());

  const setApiKey = useCallback((key: string) => {
    localStorage.setItem('adminApiKey', key);
    setApiKeyState(key);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('adminApiKey');
    setApiKeyState('');
  }, []);

  return React.createElement(
    AuthContext.Provider,
    { value: { apiKey, setApiKey, logout } },
    children
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

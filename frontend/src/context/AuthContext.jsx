import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, SESSION_ENDED_EVENT } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // Shown on the sign-in screen after an automatic sign-out.
  const [notice, setNotice] = useState('');

  const loadMe = useCallback(async () => {
    try {
      const data = await api.get('/auth/me');
      setUser(data.user);
      setSession(data.session);
    } catch {
      setUser(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    const onEnded = (e) => {
      setUser(null);
      setSession(null);
      setNotice(e.detail || 'Your session has ended. Please sign in again.');
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, []);

  const login = async (email, password) => {
    const data = await api.login(email, password);
    setNotice('');
    setUser(data.user);
    setSession(data.session);
    return data.user;
  };

  const register = async (payload) => {
    const data = await api.register(payload);
    if (data.pending) return data;
    setNotice('');
    setUser(data.user);
    setSession(data.session);
    return data;
  };

  const logout = useCallback(async (reason = '') => {
    try {
      // A signed-out student is no longer sending updates (the last position stays visible to parents).
      if (user?.role === 'student') await api.delete('/location/me').catch(() => {});
      await api.logout();
    } catch {
      // already signed out server-side
    }
    setUser(null);
    setSession(null);
    setNotice(reason);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, session, loading, notice, login, register, logout, refresh: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

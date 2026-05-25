import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User } from '../types';
import * as authUtils from '../utils/auth';
import { api } from '../utils/api';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const loadUser = useCallback(async () => {
    const token = authUtils.getAccessToken();
    if (!token) {
      setState({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }
    try {
      const res = await api.get('/auth/me');
      setState({ user: res.data.data.user, isAuthenticated: true, isLoading: false });
    } catch {
      authUtils.clearTokens();
      setState({ user: null, isAuthenticated: false, isLoading: false });
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  const login = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const { access_token, refresh_token, user } = res.data.data;
    authUtils.setTokens(access_token, refresh_token);
    setState({ user, isAuthenticated: true, isLoading: false });
  };

  const register = async (email: string, username: string, password: string) => {
    await api.post('/auth/register', { email, username, password });
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } finally {
      authUtils.clearTokens();
      setState({ user: null, isAuthenticated: false, isLoading: false });
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

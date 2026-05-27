import axios, { InternalAxiosRequestConfig } from 'axios';
import * as authUtils from './auth';

// In dev: Vite proxy handles /api → localhost:5000
// In prod: VITE_API_URL = https://api.neural.cella.website/api
const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Endpoints that may legitimately run without a Bearer token.
const PUBLIC_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/google'];

const attachAuth = (config: InternalAxiosRequestConfig) => {
  const url = config.url ?? '';
  const isPublic = PUBLIC_PATHS.some((p) => url.startsWith(p) || url.includes(p));
  const token = authUtils.getAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    return config;
  }
  if (isPublic) return config;

  // Authenticated request with no token in localStorage. Bail instead of
  // firing an unauthenticated request that will 401 and confuse downstream
  // error handling.
  authUtils.clearTokens();
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login?error=missing_token';
  }
  return Promise.reject(new Error('Missing access token'));
};
api.interceptors.request.use(attachAuth);

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

const subscribeTokenRefresh = (cb: (token: string) => void) => refreshSubscribers.push(cb);

const onRefreshComplete = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as typeof error.config & { _retry?: boolean };

    if (error.response?.status === 401 && error.response?.data?.logout) {
      authUtils.clearTokens();
      localStorage.removeItem('drive_connected');
      window.location.href = '/login?error=account_mismatch';
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && error.response?.data?.disconnect_drive) {
      localStorage.removeItem('drive_connected');
    }

    if (error.response?.status !== 401 || original._retry) return Promise.reject(error);

    const refreshToken = authUtils.getRefreshToken();
    if (!refreshToken) {
      authUtils.clearTokens();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve) => {
        subscribeTokenRefresh((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          resolve(api(original));
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const res = await api.post('/auth/refresh', { refresh_token: refreshToken });
      const { access_token } = res.data.data;
      authUtils.setTokens(access_token, refreshToken);
      api.defaults.headers.common.Authorization = `Bearer ${access_token}`;
      onRefreshComplete(access_token);
      original.headers.Authorization = `Bearer ${access_token}`;
      return api(original);
    } catch {
      authUtils.clearTokens();
      window.location.href = '/login';
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  }
);

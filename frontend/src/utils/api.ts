import axios from 'axios';
import * as authUtils from './auth';

// In dev: Vite proxy handles /api → localhost:5000
// In prod: VITE_API_URL = https://neural-network-backend.YOUR.workers.dev
const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = authUtils.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

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

    // Handle account mismatch logout
    if (error.response?.status === 401 && error.response?.data?.logout) {
      authUtils.clearTokens();
      // Clear Drive connection flag
      localStorage.removeItem('drive_connected');
      // Redirect to login with message
      window.location.href = '/login?error=account_mismatch';
      return Promise.reject(error);
    }

    // Handle Drive disconnect
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

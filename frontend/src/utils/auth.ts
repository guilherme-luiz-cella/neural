const ACCESS_TOKEN_KEY = 'nn_access_token';
const REFRESH_TOKEN_KEY = 'nn_refresh_token';

const sanitize = (raw: string | null): string | null => {
  if (!raw) return null;
  // Defensive: a past bug could have stored literal "undefined" / "null" via
  // setItem(key, undefined as any). Treat as missing.
  if (raw === 'undefined' || raw === 'null' || raw.trim() === '') return null;
  return raw;
};

export const getAccessToken = (): string | null =>
  sanitize(localStorage.getItem(ACCESS_TOKEN_KEY));

export const getRefreshToken = (): string | null =>
  sanitize(localStorage.getItem(REFRESH_TOKEN_KEY));

export const setTokens = (accessToken: string, refreshToken: string): void => {
  if (!accessToken || !refreshToken) {
    console.warn('[auth] setTokens called with falsy value — refusing', {
      hasAccess: !!accessToken, hasRefresh: !!refreshToken,
    });
    return;
  }
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
};

export const clearTokens = (): void => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};

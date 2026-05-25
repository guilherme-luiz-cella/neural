const ITERATIONS = 100_000;
const HASH = 'SHA-256';
const KEY_LEN_BITS = 256;

export const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: HASH },
    key,
    KEY_LEN_BITS
  );

  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `pbkdf2:${saltB64}:${hashB64}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;

  const salt = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0));
  const expected = parts[2];

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: HASH },
    key,
    KEY_LEN_BITS
  );

  const actual = btoa(String.fromCharCode(...new Uint8Array(bits)));

  // Constant-time comparison to prevent timing attacks
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
};

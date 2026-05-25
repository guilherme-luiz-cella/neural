import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateEmail, validatePassword, validateUsername } from '../utils/validators';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { generateAccessToken, generateRefreshToken, verifyToken } from '../services/jwtService';

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

// ─── validators ──────────────────────────────────────────────────────────────

describe('validateEmail', () => {
  it('accepts valid email', () => expect(validateEmail('user@example.com')).toBe(true));
  it('rejects missing @', () => expect(validateEmail('userexample.com')).toBe(false));
  it('rejects missing domain', () => expect(validateEmail('user@')).toBe(false));
  it('rejects empty string', () => expect(validateEmail('')).toBe(false));
});

describe('validatePassword', () => {
  it('accepts strong password', () => expect(validatePassword('Password1').valid).toBe(true));
  it('rejects too short', () => expect(validatePassword('Pass1').valid).toBe(false));
  it('rejects no uppercase', () => expect(validatePassword('password1').valid).toBe(false));
  it('rejects no number', () => expect(validatePassword('Password').valid).toBe(false));
  it('returns all error messages', () => {
    const { errors } = validatePassword('abc');
    expect(errors.length).toBeGreaterThan(1);
  });
});

describe('validateUsername', () => {
  it('accepts valid username', () => expect(validateUsername('john_doe')).toBe(true));
  it('rejects too short', () => expect(validateUsername('ab')).toBe(false));
  it('rejects spaces', () => expect(validateUsername('john doe')).toBe(false));
  it('accepts hyphens and numbers', () => expect(validateUsername('user-123')).toBe(true));
});

// ─── crypto (PBKDF2) ─────────────────────────────────────────────────────────

describe('hashPassword / verifyPassword', () => {
  it('produces pbkdf2: prefixed hash', async () => {
    const hash = await hashPassword('Password1');
    expect(hash).toMatch(/^pbkdf2:/);
  });

  it('verifies correct password', async () => {
    const hash = await hashPassword('Password1');
    expect(await verifyPassword('Password1', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('Password1');
    expect(await verifyPassword('WrongPass1', hash)).toBe(false);
  });

  it('produces unique salts (no two hashes equal)', async () => {
    const [h1, h2] = await Promise.all([hashPassword('Password1'), hashPassword('Password1')]);
    expect(h1).not.toBe(h2);
  });

  it('rejects malformed stored hash', async () => {
    expect(await verifyPassword('Password1', 'not-a-valid-hash')).toBe(false);
  });
});

// ─── jwtService ──────────────────────────────────────────────────────────────

describe('generateAccessToken / verifyToken', () => {
  it('generates and verifies access token', async () => {
    const token = await generateAccessToken('user-123', 'user@example.com', JWT_SECRET);
    const payload = await verifyToken(token, JWT_SECRET);
    expect(payload.userId).toBe('user-123');
    expect(payload.type).toBe('access');
  });

  it('generates and verifies refresh token', async () => {
    const token = await generateRefreshToken('user-123', 'user@example.com', JWT_SECRET);
    const payload = await verifyToken(token, JWT_SECRET);
    expect(payload.type).toBe('refresh');
  });

  it('throws on tampered token', async () => {
    const token = await generateAccessToken('user-123', 'user@example.com', JWT_SECRET);
    await expect(verifyToken(token + 'tampered', JWT_SECRET)).rejects.toThrow();
  });

  it('throws on wrong secret', async () => {
    const token = await generateAccessToken('user-123', 'user@example.com', JWT_SECRET);
    await expect(verifyToken(token, 'wrong-secret')).rejects.toThrow();
  });
});

// ─── authService (Supabase mocked) ───────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import { registerUser, loginUser, refreshAccessToken, getUserById } from '../services/authService';

const makeSupabase = (overrides: Record<string, unknown> = {}) => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  return { from: vi.fn(() => chain), _chain: chain };
};

const mockUser = {
  id: 'uuid-123',
  email: 'test@example.com',
  username: 'testuser',
  password_hash: await hashPassword('Password1'),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('registerUser', () => {
  it('throws ValidationError on invalid email', async () => {
    const { _chain: chain, ...supabase } = makeSupabase();
    await expect(
      registerUser(supabase as never, JWT_SECRET, { email: 'bad', password: 'Password1', username: 'user123' })
    ).rejects.toMatchObject({ name: 'ValidationError', statusCode: 400 });
  });

  it('throws ValidationError on weak password', async () => {
    const { _chain: chain, ...supabase } = makeSupabase();
    await expect(
      registerUser(supabase as never, JWT_SECRET, { email: 'test@example.com', password: 'weak', username: 'user123' })
    ).rejects.toMatchObject({ name: 'ValidationError', statusCode: 400 });
  });

  it('throws ConflictError when email taken', async () => {
    const { _chain: chain, ...supabase } = makeSupabase({
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing' } }),
    });
    await expect(
      registerUser(supabase as never, JWT_SECRET, { email: 'test@example.com', password: 'Password1', username: 'newuser' })
    ).rejects.toMatchObject({ name: 'ConflictError', statusCode: 409 });
  });
});

describe('loginUser', () => {
  it('throws AuthenticationError when user not found', async () => {
    const { _chain: chain, ...supabase } = makeSupabase({
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    });
    await expect(
      loginUser(supabase as never, JWT_SECRET, { email: 'nobody@x.com', password: 'Password1' })
    ).rejects.toMatchObject({ name: 'AuthenticationError', statusCode: 401 });
  });

  it('throws AuthenticationError on wrong password', async () => {
    const { _chain: chain, ...supabase } = makeSupabase({
      maybeSingle: vi.fn().mockResolvedValue({ data: mockUser }),
    });
    await expect(
      loginUser(supabase as never, JWT_SECRET, { email: 'test@example.com', password: 'WrongPass1' })
    ).rejects.toMatchObject({ name: 'AuthenticationError', statusCode: 401 });
  });

  it('returns user and tokens on valid credentials', async () => {
    const { _chain: chain, ...supabase } = makeSupabase({
      maybeSingle: vi.fn().mockResolvedValue({ data: mockUser }),
    });
    const result = await loginUser(supabase as never, JWT_SECRET, {
      email: 'test@example.com',
      password: 'Password1',
    });
    expect(result.tokens.access_token).toBeTruthy();
    expect(result.user.email).toBe('test@example.com');
    expect((result.user as typeof mockUser).password_hash).toBeUndefined();
  });
});

describe('getUserById', () => {
  it('returns user on valid id', async () => {
    const { _chain: chain, ...supabase } = makeSupabase({
      maybeSingle: vi.fn().mockResolvedValue({ data: mockUser }),
    });
    const user = await getUserById(supabase as never, mockUser.id);
    expect(user.id).toBe(mockUser.id);
  });

  it('throws NotFoundError when user not found', async () => {
    const { _chain: chain, ...supabase } = makeSupabase({
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    });
    await expect(getUserById(supabase as never, 'nonexistent')).rejects.toMatchObject({
      name: 'NotFoundError',
      statusCode: 404,
    });
  });
});

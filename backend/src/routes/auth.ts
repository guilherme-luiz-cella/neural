import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import * as authService from '../services/authService';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { AppError } from '../utils/errors';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();

const db = (c: { env: Env }) =>
  createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

const onError = (err: unknown, c: Parameters<Parameters<typeof router.post>[1]>[0]) => {
  if (err instanceof AppError) {
    return c.json({ success: false, message: err.message }, err.statusCode as 400 | 401 | 404 | 409);
  }
  console.error('[Auth]', err);
  return c.json({ success: false, message: 'Internal server error' }, 500);
};

router.post('/register', async (c) => {
  try {
    const body = await c.req.json<{ email: string; password: string; username: string }>();
    const { user } = await authService.registerUser(db(c), c.env.JWT_SECRET, body);
    return c.json({ success: true, message: 'User registered successfully', data: { user } }, 201);
  } catch (err) { return onError(err, c); }
});

router.post('/login', async (c) => {
  try {
    const body = await c.req.json<{ email: string; password: string }>();
    const { user, tokens } = await authService.loginUser(db(c), c.env.JWT_SECRET, body);
    return c.json({ success: true, message: 'Login successful', data: { ...tokens, user } }, 200);
  } catch (err) { return onError(err, c); }
});

router.post('/refresh', async (c) => {
  try {
    const { refresh_token } = await c.req.json<{ refresh_token: string }>();
    if (!refresh_token) return c.json({ success: false, message: 'refresh_token is required' }, 400);
    const result = await authService.refreshAccessToken(db(c), c.env.JWT_SECRET, refresh_token);
    return c.json({ success: true, message: 'Token refreshed', data: result }, 200);
  } catch (err) { return onError(err, c); }
});

router.get('/me', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const user = await authService.getUserById(db(c), userId);
    return c.json({ success: true, message: 'User data retrieved', data: { user } }, 200);
  } catch (err) { return onError(err, c); }
});

router.post('/logout', authMiddleware, (c) =>
  c.json({ success: true, message: 'Logged out successfully' }, 200)
);

export default router;

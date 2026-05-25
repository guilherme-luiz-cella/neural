import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { generateTokenPair } from '../services/jwtService';

const router = new Hono<{ Bindings: Env }>();
const enc = (s: string) => new TextEncoder().encode(s);
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

const SCOPES = 'openid email profile';

const makeState = (origin: string, secret: string) =>
  new SignJWT({ origin, purpose: 'google_login' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(enc(secret));

const verifyState = async (state: string, secret: string) => {
  const { payload } = await jwtVerify(state, enc(secret));
  return payload as { origin: string; purpose: string };
};

const getGoogleUser = async (code: string, env: Env) => {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_LOGIN_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error('Token exchange failed');
  const { access_token } = await tokenRes.json<{ access_token: string }>();

  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) throw new Error('Failed to fetch Google user info');
  return userRes.json<{ sub: string; email: string; name: string }>();
};

const toUsername = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20) + '_' + Math.random().toString(36).slice(2, 6);

// GET /api/auth/google
router.get('/', async (c) => {
  try {
    const origin = c.req.header('Origin') ?? c.env.FRONTEND_URL.split(',')[0];
    const state = await makeState(origin, c.env.JWT_SECRET);
    const params = new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri: c.env.GOOGLE_LOGIN_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'select_account',
      state,
    });
    return c.json({
      success: true,
      message: 'Google auth URL generated',
      data: { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
    });
  } catch {
    return c.json({ success: false, message: 'Failed to generate Google auth URL' }, 500);
  }
});

// GET /api/auth/google/callback
router.get('/callback', async (c) => {
  const fallbackBase = c.env.FRONTEND_URL.split(',')[0];
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (c.req.query('error') || !code || !state) {
      return c.redirect(`${fallbackBase}/login?google_error=access_denied`);
    }

    const { origin } = await verifyState(state, c.env.JWT_SECRET);
    const googleUser = await getGoogleUser(code, c.env);
    const supabase = db(c);

    // Find or create user
    let { data: user } = await supabase
      .from('users')
      .select('id, email, username')
      .eq('email', googleUser.email)
      .maybeSingle();

    if (!user) {
      const username = toUsername(googleUser.name || googleUser.email.split('@')[0]);
      const { data: created, error } = await supabase
        .from('users')
        .insert({
          email: googleUser.email,
          username,
          password_hash: `google:${googleUser.sub}`,
        })
        .select('id, email, username')
        .single();

      if (error || !created) throw new Error(error?.message ?? 'Failed to create user');
      user = created;
    }

    const tokens = await generateTokenPair(user.id, user.email, c.env.JWT_SECRET);

    return c.redirect(
      `${origin}/auth/callback?access_token=${tokens.access_token}&refresh_token=${tokens.refresh_token}`
    );
  } catch (err) {
    console.error('[Google login callback]', err);
    return c.redirect(`${fallbackBase}/login?google_error=login_failed`);
  }
});

export default router;

import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import * as driveService from '../services/googleDriveService';
import * as crawlerService from '../services/crawlerService';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { getValidAccessToken, validateUserGoogleAccount, disconnectDrive } from './driveHelpers';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
const enc = (s: string) => new TextEncoder().encode(s);

const makeDriveState = (userId: string, secret: string, origin: string) =>
  new SignJWT({ userId, purpose: 'drive_oauth', origin })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(enc(secret));

const driveCallbackError = (err: unknown): string => {
  if (!(err instanceof Error)) return 'callback_failed';
  const message = err.message.toLowerCase();
  if (message.includes('google token exchange failed')) return 'token_exchange_failed';
  if (message.includes('failed to get google account info')) return 'account_email_scope_failed';
  if (message.includes('invalid state') || message.includes('jwt')) return 'state_expired';
  return 'callback_failed';
};

const verifyDriveState = async (state: string, secret: string) => {
  const { payload } = await jwtVerify(state, enc(secret));
  return payload as { userId: string; purpose: string; origin: string };
};

// GET /api/drive/auth-url
router.get('/auth-url', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const origin = c.req.header('Origin') ?? c.env.FRONTEND_URL.split(',')[0];
    const state = await makeDriveState(userId, c.env.JWT_SECRET, origin);
    const url = driveService.getAuthUrl(c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_REDIRECT_URI, state);
    return c.json({ success: true, message: 'Auth URL generated', data: { url } });
  } catch {
    return c.json({ success: false, message: 'Failed to generate auth URL' }, 500);
  }
});

// GET /api/drive/callback — Google redirects here
router.get('/callback', async (c) => {
  const fallbackBase = c.env.FRONTEND_URL.split(',')[0];
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (c.req.query('error') || !code || !state) {
      return c.redirect(`${fallbackBase}/dashboard?drive_error=access_denied`);
    }

    const { userId, purpose, origin } = await verifyDriveState(state, c.env.JWT_SECRET);
    if (purpose !== 'drive_oauth') throw new Error('Invalid state token');
    const frontendBase = origin ?? c.env.FRONTEND_URL.split(',')[0];

    const tokens = await driveService.exchangeCode(
      code,
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
      c.env.GOOGLE_REDIRECT_URI
    );

    const expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const googleAccountEmail = await driveService.getGoogleAccountEmail(tokens.access_token);

    await db(c).from('google_drive_auth').upsert(
      {
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at,
        google_account_email: googleAccountEmail,
      },
      { onConflict: 'user_id' }
    );

    return c.redirect(`${frontendBase}/dashboard?drive_connected=true`);
  } catch (err) {
    console.error('[Drive callback]', err);
    return c.redirect(`${fallbackBase}/dashboard?drive_error=${driveCallbackError(err)}`);
  }
});

// GET /api/drive/status
router.get('/status', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);
    const { data } = await supabase
      .from('google_drive_auth')
      .select('id, expires_at, google_account_email')
      .eq('user_id', userId)
      .maybeSingle();

    if (!data) {
      return c.json({ success: true, message: 'Drive status', data: { connected: false, account_email: null, account_mismatch: false } });
    }

    // Check for account mismatch
    try {
      const accessToken = await getValidAccessToken(supabase, userId, c.env);
      const currentEmail = await driveService.getGoogleAccountEmail(accessToken);
      const mismatch = currentEmail !== data.google_account_email;

      if (mismatch) {
        console.warn(`[Drive] Account mismatch for user ${userId}: stored=${data.google_account_email}, current=${currentEmail}`);
      }

      return c.json({
        success: true,
        message: 'Drive status',
        data: {
          connected: true,
          account_email: data.google_account_email,
          account_mismatch: mismatch,
          current_email: currentEmail,
        },
      });
    } catch {
      return c.json({
        success: true,
        message: 'Drive status',
        data: { connected: true, account_email: data.google_account_email, account_mismatch: false },
      });
    }
  } catch (err) {
    console.error('[Drive status]', err);
    return c.json({ success: false, message: 'Failed to check Drive status' }, 500);
  }
});

// GET /api/drive/files
router.get('/files', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);
    const accessToken = await getValidAccessToken(supabase, userId, c.env);

    // Validate account match
    await validateUserGoogleAccount(supabase, userId, accessToken);

    const files = await driveService.listFiles(accessToken);
    return c.json({ success: true, message: 'Drive files retrieved', data: { files } });
  } catch (err) {
    if (err instanceof Error && err.message === 'DRIVE_NOT_CONNECTED') {
      return c.json({ success: false, message: 'Google Drive not connected' }, 400);
    }
    if (err instanceof Error && err.message === 'DRIVE_SESSION_EXPIRED') {
      return c.json({ success: false, message: 'Google Drive session expired. Reconnect.' }, 401);
    }
    if (err instanceof Error && err.message === 'ACCOUNT_MISMATCH_LOGOUT') {
      return c.json({
        success: false,
        message: 'Your Google account has changed. Drive disconnected for security. Please login again.',
        logout: true,
        disconnect_drive: true,
      }, 401);
    }
    if (err instanceof Error && err.message === 'ACCOUNT_MISMATCH') {
      return c.json({
        success: false,
        message: 'Google account mismatch. The account currently logged in is different from the one used to connect Drive. Please reconnect with the correct account.',
        disconnect_drive: true,
      }, 401);
    }
    return c.json({ success: false, message: 'Failed to fetch Drive files' }, 500);
  }
});

// POST /api/drive/sync — sync Drive files into local DB
router.post('/sync', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);
    const accessToken = await getValidAccessToken(supabase, userId, c.env);

    // Validate the current Google account matches the stored account
    await validateUserGoogleAccount(supabase, userId, accessToken);

    const [driveFiles, driveFolders] = await Promise.all([
      driveService.listFiles(accessToken),
      driveService.listFolders(accessToken),
    ]);

    const folderPathById = driveService.buildFolderPathMap(driveFolders);
    const drivePath = (f: { parents?: string[] }): string | null => {
      const parentId = f.parents?.[0];
      if (!parentId) return null;
      return folderPathById.get(parentId) ?? null;
    };

    // Fetch existing Drive file IDs for this user
    const { data: existing } = await supabase
      .from('files')
      .select('id, google_drive_id')
      .eq('user_id', userId)
      .not('google_drive_id', 'is', null);

    const existingMap = new Map((existing ?? []).map((f) => [f.google_drive_id, f.id]));

    const toInsert = driveFiles
      .filter((f) => !existingMap.has(f.id))
      .map((f) => ({
        user_id: userId,
        file_name: f.name,
        file_type: f.mimeType,
        google_drive_id: f.id,
        drive_path: drivePath(f),
      }));

    const toUpdate = driveFiles
      .filter((f) => existingMap.has(f.id))
      .map((f) => ({
        id: existingMap.get(f.id)!,
        file_name: f.name,
        file_type: f.mimeType,
        drive_path: drivePath(f),
      }));

    let synced = 0;
    if (toInsert.length > 0) {
      const { data } = await supabase.from('files').insert(toInsert).select('id');
      synced += data?.length ?? 0;
    }
    for (const u of toUpdate) {
      await supabase.from('files').update({ file_name: u.file_name, file_type: u.file_type, drive_path: u.drive_path }).eq('id', u.id);
      synced++;
    }

    // Fetch and store content for newly inserted files
    if (toInsert.length > 0) {
      const { data: newFiles } = await supabase
        .from('files')
        .select('id, google_drive_id, file_type')
        .eq('user_id', userId)
        .in('file_name', toInsert.map((f) => f.file_name))
        .not('google_drive_id', 'is', null);

      if (newFiles) {
        await Promise.allSettled(
          newFiles.map(async (f) => {
            if (!f.google_drive_id || !f.file_type) return;
            try {
              const content = await crawlerService.fetchFileContent(f.google_drive_id, f.file_type, accessToken);
              if (content) {
                await supabase
                  .from('files')
                  .update({ content })
                  .eq('id', f.id);
              }
            } catch {
              // Silently fail for files that can't be fetched
            }
          })
        );
      }
    }

    return c.json({ success: true, message: `Synced ${synced} files`, data: { synced_count: synced } });
  } catch (err) {
    if (err instanceof Error && err.message === 'DRIVE_NOT_CONNECTED') {
      return c.json({ success: false, message: 'Google Drive not connected' }, 400);
    }
    if (err instanceof Error && err.message === 'ACCOUNT_MISMATCH_LOGOUT') {
      return c.json({
        success: false,
        message: 'Your Google account has changed. Drive disconnected for security. Please login again.',
        logout: true,
        disconnect_drive: true,
      }, 401);
    }
    if (err instanceof Error && err.message === 'ACCOUNT_MISMATCH') {
      return c.json({
        success: false,
        message: 'Google account mismatch. Please reconnect Drive with the correct account.',
        disconnect_drive: true,
      }, 401);
    }
    console.error('[Drive sync]', err);
    return c.json({ success: false, message: 'Sync failed' }, 500);
  }
});

// POST /api/drive/disconnect — manually disconnect Drive
router.post('/disconnect', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);
    await disconnectDrive(supabase, userId);
    return c.json({ success: true, message: 'Drive disconnected' });
  } catch (err) {
    console.error('[Drive disconnect]', err);
    return c.json({ success: false, message: 'Failed to disconnect Drive' }, 500);
  }
});

export default router;

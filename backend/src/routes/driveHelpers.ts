import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import * as driveService from '../services/googleDriveService';

export const getValidAccessToken = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
  env: Env
): Promise<string> => {
  const { data: auth } = await supabase
    .from('google_drive_auth')
    .select('access_token, refresh_token, expires_at, google_account_email')
    .eq('user_id', userId)
    .maybeSingle();

  if (!auth) throw new Error('DRIVE_NOT_CONNECTED');

  if (new Date(auth.expires_at) > new Date()) return auth.access_token;

  if (!auth.refresh_token) throw new Error('DRIVE_SESSION_EXPIRED');

  const refreshed = await driveService.refreshAccessToken(
    auth.refresh_token,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET
  );

  const expires_at = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabase
    .from('google_drive_auth')
    .update({ access_token: refreshed.access_token, expires_at })
    .eq('user_id', userId);

  return refreshed.access_token;
};

export const validateUserGoogleAccount = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
  accessToken: string
): Promise<void> => {
  const { data: auth } = await supabase
    .from('google_drive_auth')
    .select('google_account_email')
    .eq('user_id', userId)
    .maybeSingle();

  if (!auth?.google_account_email) return;

  const currentEmail = await driveService.getGoogleAccountEmail(accessToken);
  if (currentEmail !== auth.google_account_email) {
    // Account mismatch detected - disconnect Drive and log out user
    console.warn(`[Security] Account mismatch detected for user ${userId}: expected=${auth.google_account_email}, actual=${currentEmail}`);
    
    // Disconnect Drive
    await supabase.from('google_drive_auth').delete().eq('user_id', userId);
    
    // Invalidate all sessions for this user
    await supabase.from('sessions').delete().eq('user_id', userId);
    
    throw new Error('ACCOUNT_MISMATCH_LOGOUT');
  }
};

// Force disconnect Drive (used for logout)
export const disconnectDrive = async (
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<void> => {
  await supabase.from('google_drive_auth').delete().eq('user_id', userId);
};

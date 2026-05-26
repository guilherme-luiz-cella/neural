import { describe, it, expect } from 'vitest';
import { getAuthUrl } from '../services/googleDriveService';

describe('getAuthUrl', () => {
  it('requests Drive read scopes and the email scope required by callback account validation', () => {
    const authUrl = getAuthUrl('client-id', 'https://api.example.com/api/drive/callback', 'state-token');
    const url = new URL(authUrl);
    const scopes = url.searchParams.get('scope')?.split(' ') ?? [];

    expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
    expect(scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(scopes).toContain('https://www.googleapis.com/auth/drive.metadata.readonly');
  });
});

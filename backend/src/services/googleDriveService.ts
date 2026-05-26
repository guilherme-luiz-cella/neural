export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export const getAuthUrl = (clientId: string, redirectUri: string, state: string): string => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
};

export const exchangeCode = async (
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<GoogleTokens> => {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }
  return res.json();
};

export const refreshAccessToken = async (
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_in: number }> => {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Failed to refresh Google access token');
  return res.json();
};

export const getGoogleAccountEmail = async (accessToken: string): Promise<string> => {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to get Google account info');
  const data: { email: string } = await res.json();
  return data.email;
};

export const listFiles = async (accessToken: string): Promise<DriveFile[]> => {
  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      pageSize: '1000',
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size)',
      orderBy: 'modifiedTime desc',
      q: 'trashed=false',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('Failed to list Drive files');
    const data: { files: DriveFile[]; nextPageToken?: string } = await res.json();
    allFiles.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
};

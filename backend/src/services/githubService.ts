const GH = 'https://api.github.com';
const HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

export interface GHRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  updated_at: string;
  language: string | null;
}

export interface GHTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface GHFile {
  content: string;
  sha: string;
  name: string;
  path: string;
}

export const getAuthUrl = (clientId: string, redirectUri: string, state: string): string => {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'repo read:user',
    state,
  });
  return `https://github.com/login/oauth/authorize?${p}`;
};

export const exchangeCode = async (
  code: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; scope: string }> => {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) throw new Error('GitHub token exchange failed');
  return res.json<{ access_token: string; scope: string }>();
};

export const getUser = async (token: string): Promise<{ login: string; name: string }> => {
  const res = await fetch(`${GH}/user`, { headers: HEADERS(token) });
  if (!res.ok) throw new Error('Failed to fetch GitHub user');
  return res.json<{ login: string; name: string }>();
};

export const listRepos = async (token: string): Promise<GHRepo[]> => {
  const res = await fetch(`${GH}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator`, {
    headers: HEADERS(token),
  });
  if (!res.ok) throw new Error('Failed to list GitHub repos');
  return res.json<GHRepo[]>();
};

export const getRepoTree = async (token: string, owner: string, repo: string, branch: string): Promise<GHTreeItem[]> => {
  const res = await fetch(`${GH}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
    headers: HEADERS(token),
  });
  if (!res.ok) throw new Error('Failed to fetch repo tree');
  const data = await res.json<{ tree: GHTreeItem[]; truncated?: boolean }>();
  return data.tree ?? [];
};

export const getFileContent = async (token: string, owner: string, repo: string, path: string): Promise<GHFile> => {
  const res = await fetch(`${GH}/repos/${owner}/${repo}/contents/${path}`, {
    headers: HEADERS(token),
  });
  if (!res.ok) throw new Error(`Failed to fetch file: ${path}`);
  const data = await res.json<{ content: string; sha: string; name: string; path: string }>();
  // Content is base64 with newlines
  const decoded = atob(data.content.replace(/\n/g, ''));
  return { content: decoded, sha: data.sha, name: data.name, path: data.path };
};

export const pushFile = async (
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  sha: string | null,
  message: string
): Promise<{ sha: string }> => {
  const encoded = btoa(unescape(encodeURIComponent(content)));
  const body: Record<string, unknown> = { message, content: encoded };
  if (sha) body.sha = sha;

  const res = await fetch(`${GH}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...HEADERS(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub push failed: ${err}`);
  }
  const data = await res.json<{ content: { sha: string } }>();
  return { sha: data.content.sha };
};

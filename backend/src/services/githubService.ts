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

// Helper to handle rate limiting
const handleRateLimit = (response: Response): void => {
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');
  if (remaining === '0' && reset) {
    const resetTime = parseInt(reset, 10) * 1000;
    const waitMs = Math.max(resetTime - Date.now(), 0);
    console.warn(`[GitHub] Rate limit hit. Reset in ${Math.ceil(waitMs / 1000)}s`);
  }
};

// Helper to parse GitHub error responses
const parseGitHubError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json<{ message?: string; documentation_url?: string }>();
    return data.message || `GitHub API error: ${response.status}`;
  } catch {
    return `GitHub API error: ${response.status}`;
  }
};

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
  if (!res.ok) {
    const error = await parseGitHubError(res);
    throw new Error(`GitHub token exchange failed: ${error}`);
  }
  return res.json<{ access_token: string; scope: string }>();
};

export const getUser = async (token: string): Promise<{ login: string; name: string }> => {
  const res = await fetch(`${GH}/user`, { headers: HEADERS(token) });
  handleRateLimit(res);
  if (!res.ok) {
    const error = await parseGitHubError(res);
    throw new Error(`Failed to fetch GitHub user: ${error}`);
  }
  return res.json<{ login: string; name: string }>();
};

export const listRepos = async (token: string): Promise<GHRepo[]> => {
  const res = await fetch(`${GH}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator`, {
    headers: HEADERS(token),
  });
  handleRateLimit(res);
  if (!res.ok) {
    const error = await parseGitHubError(res);
    throw new Error(`Failed to list GitHub repos: ${error}`);
  }
  return res.json<GHRepo[]>();
};

export const getRepoTree = async (token: string, owner: string, repo: string, branch: string): Promise<GHTreeItem[]> => {
  const res = await fetch(`${GH}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
    headers: HEADERS(token),
  });
  handleRateLimit(res);
  if (res.status === 404) throw new Error(`Repository or branch not found: ${owner}/${repo}:${branch}`);
  if (!res.ok) {
    const error = await parseGitHubError(res);
    throw new Error(`Failed to fetch repo tree: ${error}`);
  }
  const data = await res.json<{ tree: GHTreeItem[]; truncated?: boolean }>();
  return data.tree ?? [];
};

export const getFileContent = async (token: string, owner: string, repo: string, path: string): Promise<GHFile> => {
  const res = await fetch(`${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    headers: HEADERS(token),
  });
  handleRateLimit(res);
  if (res.status === 404) throw new Error(`File not found: ${path}`);
  if (!res.ok) {
    const error = await parseGitHubError(res);
    throw new Error(`Failed to fetch file ${path}: ${error}`);
  }
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

  const res = await fetch(`${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...HEADERS(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  handleRateLimit(res);
  if (!res.ok) {
    const error = await parseGitHubError(res);
    throw new Error(`GitHub push failed: ${error}`);
  }
  const data = await res.json<{ content: { sha: string } }>();
  return { sha: data.content.sha };
};

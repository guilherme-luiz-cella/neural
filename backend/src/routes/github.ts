import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { NotFoundError, AppError } from '../utils/errors';
import * as gh from '../services/githubService';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
const enc = (s: string) => new TextEncoder().encode(s);

const makeState = (userId: string, origin: string, secret: string) =>
  new SignJWT({ userId, origin, purpose: 'github_oauth' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(enc(secret));

const verifyState = async (state: string, secret: string) => {
  const { payload } = await jwtVerify(state, enc(secret));
  return payload as { userId: string; origin: string; purpose: string };
};

const getToken = async (supabase: ReturnType<typeof db>, userId: string): Promise<string> => {
  const { data } = await supabase
    .from('github_auth')
    .select('access_token')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new Error('GITHUB_NOT_CONNECTED');
  return data.access_token;
};

const onError = (err: unknown, c: Parameters<Parameters<typeof router.get>[1]>[0]) => {
  if (err instanceof Error && err.message === 'GITHUB_NOT_CONNECTED') {
    return c.json({ success: false, message: 'GitHub not connected' }, 400);
  }
  if (err instanceof AppError) {
    return c.json({ success: false, message: err.message }, err.statusCode as 400 | 404 | 409);
  }
  console.error('[GitHub]', err);
  return c.json({ success: false, message: 'GitHub error' }, 500);
};

// GET /api/github — return OAuth URL
router.get('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const origin = c.req.header('Origin') ?? c.env.FRONTEND_URL.split(',')[0];
    const state = await makeState(userId, origin, c.env.JWT_SECRET);
    const url = gh.getAuthUrl(c.env.GITHUB_CLIENT_ID, c.env.GITHUB_REDIRECT_URI, state);
    return c.json({ success: true, message: 'GitHub auth URL', data: { url } });
  } catch (err) { return onError(err, c); }
});

// GET /api/github/callback
router.get('/callback', async (c) => {
  const fallback = c.env.FRONTEND_URL.split(',')[0];
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.redirect(`${fallback}/dashboard?github_error=missing_params`);

    const { userId, origin } = await verifyState(state, c.env.JWT_SECRET);
    const tokens = await gh.exchangeCode(code, c.env.GITHUB_CLIENT_ID, c.env.GITHUB_CLIENT_SECRET);
    if (!tokens.access_token) return c.redirect(`${origin}/dashboard?github_error=no_token`);

    const ghUser = await gh.getUser(tokens.access_token);

    await db(c).from('github_auth').upsert(
      {
        user_id: userId,
        access_token: tokens.access_token,
        scope: tokens.scope,
        github_username: ghUser.login,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    return c.redirect(`${origin}/dashboard?github_connected=true`);
  } catch (err) {
    console.error('[GitHub callback]', err);
    return c.redirect(`${fallback}/dashboard?github_error=callback_failed`);
  }
});

// GET /api/github/status
router.get('/status', authMiddleware, async (c) => {
  const { userId } = c.get('user');
  const { data } = await db(c)
    .from('github_auth')
    .select('github_username')
    .eq('user_id', userId)
    .maybeSingle();
  return c.json({ success: true, message: 'GitHub status', data: { connected: !!data, username: data?.github_username } });
});

// GET /api/github/repos
router.get('/repos', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const token = await getToken(db(c), userId);
    const repos = await gh.listRepos(token);
    return c.json({ success: true, message: 'Repos retrieved', data: { repos } });
  } catch (err) { return onError(err, c); }
});

// GET /api/github/repos/:owner/:repo/tree
router.get('/repos/:owner/:repo/tree', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const { owner, repo } = c.req.param();
    const branch = c.req.query('branch') ?? 'main';
    const token = await getToken(db(c), userId);
    const tree = await gh.getRepoTree(token, owner, repo, branch);
    // Only return blobs (files), exclude binaries by extension heuristic
    const TEXT_EXTS = /\.(ts|tsx|js|jsx|py|go|rs|java|cs|cpp|c|rb|php|swift|kt|html|css|scss|json|yaml|yml|md|txt|sh|sql|toml|env\.example|gitignore|dockerfile)$/i;
    const files = tree
      .filter((item) => item.type === 'blob' && TEXT_EXTS.test(item.path))
      .map((item) => ({ path: item.path, sha: item.sha, size: item.size ?? 0 }));
    return c.json({ success: true, message: 'Tree retrieved', data: { files } });
  } catch (err) { return onError(err, c); }
});

// POST /api/github/repos/:owner/:repo/import — import specific files
router.post('/repos/:owner/:repo/import', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const { owner, repo } = c.req.param();
    const body = await c.req.json<{ paths: string[]; project_id?: string }>();
    if (!body.paths?.length) return c.json({ success: false, message: 'paths required' }, 400);

    const token = await getToken(db(c), userId);
    const supabase = db(c);
    let imported = 0;

    await Promise.allSettled(
      body.paths.slice(0, 50).map(async (path) => {
        try {
          const file = await gh.getFileContent(token, owner, repo, path);
          const fileName = path.split('/').pop() ?? path;
          const mimeType = guessMime(fileName);

          await supabase.from('files').upsert(
            {
              user_id: userId,
              file_name: fileName,
              file_type: mimeType,
              content: file.content.slice(0, 50_000),
              github_repo: `${owner}/${repo}`,
              github_path: path,
              github_sha: file.sha,
              project_id: body.project_id ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,github_path,github_repo' }
          );
          imported++;
        } catch { /* skip unparseable files */ }
      })
    );

    return c.json({ success: true, message: `Imported ${imported} files`, data: { imported } });
  } catch (err) { return onError(err, c); }
});

// PUT /api/github/push/:fileId — push local edits back to GitHub
router.put('/push/:fileId', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const fileId = c.req.param('fileId');
    const body = await c.req.json<{ commit_message?: string }>();

    const { data: file, error } = await db(c)
      .from('files')
      .select('content, github_repo, github_path, github_sha')
      .eq('id', fileId)
      .eq('user_id', userId)
      .single();

    if (error || !file) throw new NotFoundError('File not found');
    if (!file.github_repo || !file.github_path) {
      return c.json({ success: false, message: 'File not linked to a GitHub repo' }, 400);
    }

    const token = await getToken(db(c), userId);
    const [owner, repo] = file.github_repo.split('/');
    const message = body.commit_message ?? `Update ${file.github_path} via Neural Network`;

    const result = await gh.pushFile(token, owner, repo, file.github_path, file.content ?? '', file.github_sha, message);

    await db(c).from('files').update({ github_sha: result.sha, updated_at: new Date().toISOString() }).eq('id', fileId);

    return c.json({ success: true, message: 'Pushed to GitHub', data: { sha: result.sha } });
  } catch (err) { return onError(err, c); }
});

const EXT_MIME: Record<string, string> = {
  ts: 'text/typescript', tsx: 'text/typescript', js: 'text/javascript', jsx: 'text/javascript',
  py: 'text/x-python', go: 'text/x-go', rs: 'text/x-rust', java: 'text/x-java',
  cs: 'text/x-csharp', cpp: 'text/x-cpp', c: 'text/x-c', rb: 'text/x-ruby',
  php: 'text/x-php', swift: 'text/x-swift', kt: 'text/x-kotlin',
  html: 'text/html', css: 'text/css', scss: 'text/x-scss',
  json: 'application/json', yaml: 'text/x-yaml', yml: 'text/x-yaml',
  md: 'text/markdown', txt: 'text/plain', sh: 'application/x-sh',
  sql: 'application/sql', toml: 'text/x-toml',
};

const guessMime = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'text/plain';
};

export default router;

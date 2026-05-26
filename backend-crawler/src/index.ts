import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Env, JwtPayload } from '../../backend/src/types';
import { verifyToken } from '../../backend/src/services/jwtService';
import { getValidAccessToken } from '../../backend/src/routes/driveHelpers';
import * as crawler from '../../backend/src/services/crawlerService';

type AuthVariables = { user: JwtPayload };
type AppEnv = { Bindings: Env; Variables: AuthVariables };

const app = new Hono<AppEnv>();

const db = (env: Env): SupabaseClient =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

// CORS — mirror main API allowlist
app.use('*', async (c, next) => {
  const raw = (c.env.FRONTEND_URL || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const exact = new Set(raw.filter((o) => !o.startsWith('*.')));
  const suffixes = raw.filter((o) => o.startsWith('*.')).map((o) => o.slice(1));
  const isAllowed = (origin: string): boolean => {
    if (exact.has(origin)) return true;
    try {
      const host = new URL(origin).hostname;
      return suffixes.some((s) => host === s.slice(1) || host.endsWith(s));
    } catch { return false; }
  };
  const fallback = raw[0] ?? '*';
  return cors({
    origin: raw.length === 1 && raw[0] === '*' ? '*' : (o) => (o && isAllowed(o) ? o : fallback),
    credentials: true,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next);
});

const authMiddleware = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ success: false, message: 'Authorization token required' }, 401);
  }
  try {
    const payload = await verifyToken(header.substring(7), c.env.JWT_SECRET);
    if (payload.type !== 'access') {
      console.warn('[Crawler:auth] wrong token type', { type: payload.type, path: c.req.path });
      return c.json({ success: false, message: 'Invalid token type' }, 401);
    }
    c.set('user', payload);
    await next();
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn('[Crawler:auth] verifyToken failed', { reason, path: c.req.path });
    return c.json({ success: false, message: 'Invalid or expired token' }, 401);
  }
});

// Tuned for Workers paid plan (1000 subrequests / 30s CPU). Free plan: drop
// CRAWL_BATCH to 20, CRAWL_CONCURRENCY to 4.
const CRAWL_BATCH = 40;
const CRAWL_CONCURRENCY = 6;

// File types the crawler never extracts text from. Skip at query level so
// folders/shortcuts/images/video/archives don't consume batch slots.
const UNCRAWLABLE_PREFIXES = ['image/', 'video/', 'audio/'] as const;
const UNCRAWLABLE_EXACT = new Set<string>([
  'application/vnd.google-apps.folder',
  'application/vnd.google-apps.shortcut',
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
]);
const isCrawlable = (mime: string | null): boolean => {
  if (!mime) return false;
  if (UNCRAWLABLE_EXACT.has(mime)) return false;
  return !UNCRAWLABLE_PREFIXES.some((p) => mime.startsWith(p));
};

const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  let cursor = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try { await worker(items[i]); } catch { /* swallow */ }
    }
  });
  await Promise.all(runners);
};

type CrawlResult = { crawled: number; connections: number; indexed: number; remaining: number };

const crawlOneBatch = (supabase: SupabaseClient, env: Env, userId: string): Promise<CrawlResult> =>
  crawler.runIncrementalCrawlBatch(supabase, userId, {
    batchSize: CRAWL_BATCH,
    concurrency: CRAWL_CONCURRENCY,
    isCrawlable,
    getAccessToken: () => getValidAccessToken(
      supabase as unknown as Parameters<typeof getValidAccessToken>[0],
      userId,
      env,
    ),
  });

app.get('/health', (c) => c.json({ success: true, message: 'Crawler worker running' }));

// Single batch — same response shape as legacy /api/crawler/run
app.post('/run', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c.env);
    const result = await crawlOneBatch(supabase, c.env, userId);
    const tail = result.remaining > 0 ? ` · ${result.remaining} pending (run again)` : '';
    return c.json({
      success: true,
      message: `Crawled ${result.crawled} new · ${result.indexed} indexed · ${result.connections} connections${tail}`,
      data: result,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'DRIVE_NOT_CONNECTED') {
      return c.json({ success: false, message: 'Google Drive not connected' }, 400);
    }
    console.error('[Crawler:/run]', err);
    return c.json({ success: false, message: 'Crawler failed' }, 500);
  }
});

// Loop until done — uses ctx.waitUntil so HTTP returns immediately and crawl
// continues in background (up to remaining CPU). Returns a job-id-ish ack.
app.post('/run-all', authMiddleware, async (c) => {
  const { userId } = c.get('user');
  const supabase = db(c.env);

  // Run first batch synchronously to surface DRIVE_NOT_CONNECTED early.
  let first: CrawlResult;
  try {
    first = await crawlOneBatch(supabase, c.env, userId);
  } catch (err) {
    if (err instanceof Error && err.message === 'DRIVE_NOT_CONNECTED') {
      return c.json({ success: false, message: 'Google Drive not connected' }, 400);
    }
    console.error('[Crawler:/run-all first]', err);
    return c.json({ success: false, message: 'Crawler failed' }, 500);
  }

  if (first.remaining === 0) {
    return c.json({ success: true, message: 'Crawl complete', data: { ...first, done: true } });
  }

  // Continue in background. ctx.waitUntil holds the worker alive until promise
  // resolves OR CPU budget is hit. Cron picks up leftovers.
  c.executionCtx.waitUntil((async () => {
    let safety = 60; // hard cap: 60 batches * 40 = 2400 files per request
    while (safety-- > 0) {
      try {
        const r = await crawlOneBatch(supabase, c.env, userId);
        if (r.remaining === 0) break;
      } catch (err) {
        console.error('[Crawler:/run-all bg]', err);
        break;
      }
    }
  })());

  return c.json({
    success: true,
    message: `Crawling in background · ${first.crawled} done · ${first.remaining} pending`,
    data: { ...first, done: false },
  });
});

app.notFound((c) => c.json({ success: false, message: 'Route not found' }, 404));

// Cron handler — sweep all users with pending content, one batch each.
const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, ctx) => {
  ctx.waitUntil((async () => {
    const supabase = db(env);
    const { data: pending } = await supabase
      .from('files')
      .select('user_id')
      .is('content', null)
      .not('google_drive_id', 'is', null)
      .not('file_type', 'is', null);

    const userIds = [...new Set((pending ?? []).map((r: { user_id: string }) => r.user_id))];
    for (const userId of userIds) {
      try {
        await crawlOneBatch(supabase, env, userId);
      } catch (err) {
        console.error('[Crawler:cron]', userId, err);
      }
    }
  })());
};

export default {
  fetch: app.fetch,
  scheduled,
};

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

// Opt-in queue: a user only gets crawled when they have an active job row.
// Frontend's Crawl button inserts one. Cron sweeps these only — never
// touches users who didn't ask to be crawled.
const upsertCrawlerJob = async (supabase: SupabaseClient, userId: string): Promise<void> => {
  // Reuse the latest non-completed job, or create a new one.
  const { data: existing } = await supabase
    .from('crawler_jobs')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase.from('crawler_jobs').update({ status: 'running' }).eq('id', existing.id);
    return;
  }
  await supabase.from('crawler_jobs').insert({
    user_id: userId,
    status: 'running',
    total_files: 0,
    processed_files: 0,
  });
};

const advanceJob = async (
  supabase: SupabaseClient,
  userId: string,
  delta: number,
  done: boolean,
): Promise<void> => {
  const { data: job } = await supabase
    .from('crawler_jobs')
    .select('id, processed_files, total_files')
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!job) return;

  const patch: Record<string, unknown> = {
    processed_files: (job.processed_files ?? 0) + delta,
  };
  if (done) {
    patch.status = 'completed';
    patch.completed_at = new Date().toISOString();
  }
  await supabase.from('crawler_jobs').update(patch).eq('id', job.id);
};

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

  // Opt-in: insert/refresh a job row so cron will keep working through this
  // user's pending files even after the request ends.
  await upsertCrawlerJob(supabase, userId);

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

  await advanceJob(supabase, userId, first.crawled, first.remaining === 0);

  if (first.remaining === 0) {
    return c.json({ success: true, message: 'Crawl complete', data: { ...first, done: true } });
  }

  c.executionCtx.waitUntil((async () => {
    let safety = 60;
    while (safety-- > 0) {
      try {
        const r = await crawlOneBatch(supabase, c.env, userId);
        await advanceJob(supabase, userId, r.crawled, r.remaining === 0);
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

// GET /status — frontend polls this to show progress for the active user.
app.get('/status', authMiddleware, async (c) => {
  const { userId } = c.get('user');
  const supabase = db(c.env);

  const [{ data: job }, { count: pending }, { count: indexed }] = await Promise.all([
    supabase.from('crawler_jobs')
      .select('id, status, total_files, processed_files, created_at, completed_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('files')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('content', null)
      .not('google_drive_id', 'is', null)
      .not('file_type', 'is', null),
    supabase.from('files')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('content', 'is', null),
  ]);

  return c.json({
    success: true,
    data: {
      job,
      indexed: indexed ?? 0,
      remaining: pending ?? 0,
      done: (pending ?? 0) === 0,
    },
  });
});

// POST /cancel — user stops their crawl. Marks job completed, cron drops them.
app.post('/cancel', authMiddleware, async (c) => {
  const { userId } = c.get('user');
  const supabase = db(c.env);
  await supabase
    .from('crawler_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('status', ['queued', 'running']);
  return c.json({ success: true, message: 'Crawl cancelled' });
});

app.notFound((c) => c.json({ success: false, message: 'Route not found' }, 404));

// Cron handler — sweep only users with an active crawler_jobs row. This
// prevents the crawler from auto-running for users who haven't opted in by
// clicking the Crawl button.
const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, ctx) => {
  ctx.waitUntil((async () => {
    const supabase = db(env);
    const { data: jobs } = await supabase
      .from('crawler_jobs')
      .select('user_id')
      .in('status', ['queued', 'running']);

    const userIds = [...new Set((jobs ?? []).map((r: { user_id: string }) => r.user_id))];
    if (userIds.length === 0) {
      console.log('[Crawler:cron] no active jobs');
      return;
    }

    for (const userId of userIds) {
      try {
        const r = await crawlOneBatch(supabase, env, userId);
        await advanceJob(supabase, userId, r.crawled, r.remaining === 0);
        console.log(`[Crawler:cron] user=${userId.slice(0, 8)} crawled=${r.crawled} conns=${r.connections} remaining=${r.remaining}`);
      } catch (err) {
        if (err instanceof Error && err.message === 'DRIVE_NOT_CONNECTED') {
          // Drive disconnected — kill the job so we stop pestering them.
          await supabase
            .from('crawler_jobs')
            .update({ status: 'cancelled', error_message: 'DRIVE_NOT_CONNECTED', completed_at: new Date().toISOString() })
            .eq('user_id', userId)
            .in('status', ['queued', 'running']);
          continue;
        }
        console.error('[Crawler:cron]', userId, err);
      }
    }
  })());
};

export default {
  fetch: app.fetch,
  scheduled,
};

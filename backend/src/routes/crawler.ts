import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { getValidAccessToken } from './driveHelpers';
import * as crawler from '../services/crawlerService';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

// CF Workers cap subrequests per request (50 free / 1000 paid) and CPU time
// (30s default). PDF parsing via unpdf is CPU-heavy — keep batch small on the
// main API worker. For larger crawls, deploy the solo crawler worker
// (backend-crawler) which has its own request budget + cron sweep.
const CRAWL_BATCH = 10;
const CRAWL_CONCURRENCY = 3;

// File types the crawler never extracts text from. Filtering at the query
// level keeps these out of the pending pool entirely (was burning batches on
// 351 folders, 325 shortcuts, ~1400 images, 63 mp4, ~95 archives).
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
      try { await worker(items[i]); } catch { /* swallow per-file errors */ }
    }
  });
  await Promise.all(runners);
};

// POST /api/crawler/run — status-only on the main API. Doing real work here
// blows the Workers free-plan CPU limit (PDF parsing alone is hundreds of
// ms). The crawler worker's cron (every minute) drains the pending queue
// in the background. Frontend can poll this for progress, or hit the
// solo crawler worker's /run-all for an in-band background kick.
router.post('/run', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);

    const { count: pending } = await supabase
      .from('files')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('content', null)
      .not('google_drive_id', 'is', null)
      .not('file_type', 'is', null);

    const { count: indexed } = await supabase
      .from('files')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('content', 'is', null);

    const remaining = pending ?? 0;
    const done = remaining === 0;
    const message = done
      ? 'All files indexed'
      : `Crawling in background · ${indexed ?? 0} indexed · ${remaining} pending. Cron processes ~40/min — check the graph again shortly.`;

    return c.json({
      success: true,
      message,
      data: { crawled: 0, connections: 0, indexed: indexed ?? 0, remaining, done },
    });
  } catch (err) {
    console.error('[Crawler:status]', err);
    return c.json({ success: false, message: 'Crawler status failed' }, 500);
  }
});

// POST /api/crawler/rebuild-connections — heavy: loads all content and
// recomputes the connection graph. Run after crawl is mostly done.
router.post('/rebuild-connections', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);

    const { data: files, error } = await supabase
      .from('files')
      .select('id, file_name, content')
      .eq('user_id', userId)
      .not('content', 'is', null);

    if (error) throw new Error(error.message);
    const rows = (files ?? []).filter((f: { content: string | null }) => f.content && f.content.trim().length > 0);
    if (rows.length === 0) {
      return c.json({ success: true, message: 'No content to connect', data: { connections: 0, indexed: 0 } });
    }

    const contentMap = new Map<string, string>(rows.map((f: { id: string; content: string }) => [f.id, f.content]));
    const namesMap = new Map<string, string>(rows.map((f: { id: string; file_name: string }) => [f.id, f.file_name]));
    const ids = [...contentMap.keys()];

    const toUpsert = crawler.buildConnections({
      ids, contentMap, namesMap,
      enableSemantic: true, enableName: true,
    });

    let connCreated = 0;
    if (toUpsert.length > 0) {
      await supabase
        .from('connections')
        .delete()
        .in('file_1_id', ids)
        .eq('created_by', 'crawler');
      const { data: inserted } = await supabase
        .from('connections')
        .insert(toUpsert)
        .select('id');
      connCreated = inserted?.length ?? 0;
    }

    return c.json({
      success: true,
      message: `Rebuilt ${connCreated} connections across ${ids.length} files`,
      data: { connections: connCreated, indexed: ids.length },
    });
  } catch (err) {
    console.error('[Crawler:rebuild]', err);
    return c.json({ success: false, message: 'Rebuild failed' }, 500);
  }
});

export default router;

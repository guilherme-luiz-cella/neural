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
// (30s default). Processing 1000+ files in one shot blows past both. We crawl
// only files that don't have content yet, up to a hard limit, and let the user
// (or a future cron) re-run until everything is covered.
const CRAWL_BATCH = 40;
const CRAWL_CONCURRENCY = 6;

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

// POST /api/crawler/run — fetch content for missing-content Drive files in
// batches, then compute subject connections from everything we already have.
router.post('/run', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);

    const accessToken = await getValidAccessToken(supabase, userId, c.env);

    const { data: files, error } = await supabase
      .from('files')
      .select('id, file_name, file_type, google_drive_id, content')
      .eq('user_id', userId)
      .not('google_drive_id', 'is', null);

    if (error) throw new Error(error.message);
    if (!files || files.length === 0) {
      return c.json({ success: true, message: 'No Drive files to crawl', data: { crawled: 0, connections: 0, remaining: 0 } });
    }

    const needsContent = files.filter((f) => !f.content && f.google_drive_id && f.file_type);
    const toFetch = needsContent.slice(0, CRAWL_BATCH);
    const remaining = Math.max(0, needsContent.length - toFetch.length);

    const contentMap = new Map<string, string>();
    const namesMap = new Map<string, string>();
    let crawled = 0;

    // Seed maps with already-stored content so connection building covers everything
    for (const f of files) {
      if (f.content) {
        contentMap.set(f.id, f.content);
        namesMap.set(f.id, f.file_name);
      }
    }

    await runWithConcurrency(toFetch, CRAWL_CONCURRENCY, async (f) => {
      if (!f.google_drive_id || !f.file_type) return;
      const content = await crawler.fetchFileContent(f.google_drive_id, f.file_type, accessToken);
      if (content && content.trim()) {
        await supabase
          .from('files')
          .update({ content, updated_at: new Date().toISOString() })
          .eq('id', f.id);
        contentMap.set(f.id, content);
        namesMap.set(f.id, f.file_name);
        crawled++;
      }
    });

    const ids = [...contentMap.keys()];
    const toUpsert = crawler.buildConnections({
      ids,
      contentMap,
      namesMap,
      enableSemantic: true,
      enableName: true,
    });

    let connCreated = 0;
    if (toUpsert.length > 0) {
      // Delete old crawler connections for this user's files, re-insert
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

    const indexed = contentMap.size;
    const tail = remaining > 0 ? ` · ${remaining} pending (run again)` : '';
    return c.json({
      success: true,
      message: `Crawled ${crawled} new · ${indexed} indexed · ${connCreated} connections${tail}`,
      data: { crawled, connections: connCreated, indexed, remaining },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'DRIVE_NOT_CONNECTED') {
      return c.json({ success: false, message: 'Google Drive not connected' }, 400);
    }
    console.error('[Crawler]', err);
    return c.json({ success: false, message: 'Crawler failed' }, 500);
  }
});

export default router;

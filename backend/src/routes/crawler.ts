import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

// The actual crawl runs in the Supabase Edge Function `crawl-batch` (Deno,
// gte-small embeddings, pgvector kNN). The main backend is thin glue:
//   /run-all  — kicks a crawler_jobs row for the current user, optionally
//               triggers the edge function with that user_id for a fast
//               first-batch (cron will keep going every minute).
//   /status   — returns indexed/pending counts + active-job state.
//   /cancel   — flips active jobs to cancelled.

const EDGE_FUNCTION_URL = (env: Env): string =>
  `${env.SUPABASE_URL}/functions/v1/crawl-batch`;

router.post('/run-all', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);

    // Confirm Drive is connected before queuing — saves the cron from
    // immediately cancelling the job with DRIVE_NOT_CONNECTED.
    const { data: auth } = await supabase
      .from('google_drive_auth')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!auth) {
      return c.json({ success: false, message: 'Google Drive not connected' }, 400);
    }

    // Upsert an active job — never duplicates if one already exists.
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
    } else {
      await supabase.from('crawler_jobs').insert({
        user_id: userId,
        status: 'running',
        total_files: 0,
        processed_files: 0,
      });
    }

    // Fire-and-forget: trigger the edge function NOW for this user so the
    // first batch lands before the next cron tick. We don't await — keeps
    // the main API response fast.
    fetch(EDGE_FUNCTION_URL(c.env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    }).catch((err) => console.warn('[Crawler] edge kick failed (cron will catch it):', err));

    return c.json({
      success: true,
      message: 'Crawl queued. First batch starting now; cron continues every minute.',
      data: { queued: true },
    });
  } catch (err) {
    console.error('[Crawler:/run-all]', err);
    return c.json({ success: false, message: 'Failed to queue crawl' }, 500);
  }
});

router.get('/status', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);

    const [{ data: job }, { count: pending }, { count: indexed }, { count: connCount }] = await Promise.all([
      supabase
        .from('crawler_jobs')
        .select('id, status, processed_files, total_files, created_at, completed_at, error_message')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('files')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('content', null)
        .not('google_drive_id', 'is', null)
        .not('file_type', 'is', null),
      supabase
        .from('files')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .not('content', 'is', null),
      supabase
        .from('files')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .not('content', 'is', null),
    ]);

    const remaining = pending ?? 0;
    const done = remaining === 0;
    return c.json({
      success: true,
      data: {
        job,
        indexed: indexed ?? 0,
        remaining,
        connections: connCount ?? 0,
        done,
      },
    });
  } catch (err) {
    console.error('[Crawler:/status]', err);
    return c.json({ success: false, message: 'Crawler status failed' }, 500);
  }
});

router.post('/cancel', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);
    await supabase
      .from('crawler_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('status', ['queued', 'running']);
    return c.json({ success: true, message: 'Crawl cancelled' });
  } catch (err) {
    console.error('[Crawler:/cancel]', err);
    return c.json({ success: false, message: 'Cancel failed' }, 500);
  }
});

// Legacy alias kept so the previous frontend bundle still works during a
// rolling deploy. Routes to /status under the hood.
router.post('/run', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);
    const [{ count: pending }, { count: indexed }] = await Promise.all([
      supabase
        .from('files').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).is('content', null)
        .not('google_drive_id', 'is', null).not('file_type', 'is', null),
      supabase
        .from('files').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).not('content', 'is', null),
    ]);
    const remaining = pending ?? 0;
    return c.json({
      success: true,
      message: remaining === 0 ? 'All files indexed' : `Crawling · ${indexed ?? 0} indexed · ${remaining} pending`,
      data: { crawled: 0, connections: 0, indexed: indexed ?? 0, remaining, done: remaining === 0 },
    });
  } catch (err) {
    console.error('[Crawler:/run alias]', err);
    return c.json({ success: false, message: 'Status failed' }, 500);
  }
});

export default router;

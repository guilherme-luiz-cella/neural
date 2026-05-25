import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { getValidAccessToken } from './driveHelpers';
import * as crawler from '../services/crawlerService';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

// POST /api/crawler/run — fetch content for all Drive files, compute connections
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
      return c.json({ success: true, message: 'No Drive files to crawl', data: { crawled: 0, connections: 0 } });
    }

    // Fetch content for files without content (or all)
    const contentMap = new Map<string, string>();
    let crawled = 0;

    await Promise.allSettled(
      files.map(async (f) => {
        if (!f.google_drive_id || !f.file_type) return;
        const content = await crawler.fetchFileContent(f.google_drive_id, f.file_type, accessToken);
        if (content && content.trim()) {
          await supabase
            .from('files')
            .update({ content, updated_at: new Date().toISOString() })
            .eq('id', f.id);
          contentMap.set(f.id, content);
          crawled++;
        } else if (f.content) {
          contentMap.set(f.id, f.content);
        }
      })
    );

    // Compute pairwise similarity and upsert connections
    const ids = [...contentMap.keys()];
    const kwMap = new Map(ids.map((id) => [id, crawler.extractKeywords(contentMap.get(id)!)]));

    const THRESHOLD = 0.05;
    const toUpsert: Array<{ file_1_id: string; file_2_id: string; similarity_score: number; created_by: string; connection_type: string }> = [];

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const score = crawler.computeSimilarity(kwMap.get(ids[i])!, kwMap.get(ids[j])!);
        if (score >= THRESHOLD) {
          toUpsert.push({
            file_1_id: ids[i],
            file_2_id: ids[j],
            similarity_score: Math.round(score * 1000) / 1000,
            created_by: 'crawler',
            connection_type: 'semantic',
          });
        }
      }
    }

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

    return c.json({
      success: true,
      message: `Crawled ${crawled} files, created ${connCreated} connections`,
      data: { crawled, connections: connCreated },
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

#!/usr/bin/env node
/**
 * Standalone crawler runner — for hosting on a bare-metal server (no CF
 * Worker caps). Loops over all users with pending content, processes
 * batches until done, sleeps, repeats.
 *
 * Usage:
 *   node --experimental-vm-modules dist/cli.js
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *
 * Optional env:
 *   CRAWL_BATCH (default 80)        — files per batch (no CF CPU cap here)
 *   CRAWL_CONCURRENCY (default 12)  — parallel Drive fetches
 *   CRAWL_INTERVAL_MS (default 30000) — pause between idle sweeps
 *   CRAWL_USER_ID (optional)        — restrict to a single user, else sweep all
 */

import { createClient } from '@supabase/supabase-js';
import * as crawler from '../../backend/src/services/crawlerService';
import { getValidAccessToken } from '../../backend/src/routes/driveHelpers';
import type { Env } from '../../backend/src/types';

const env: Env = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ?? '',
  JWT_SECRET: '',
  FRONTEND_URL: '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
  GOOGLE_REDIRECT_URI: '',
  GOOGLE_LOGIN_REDIRECT_URI: '',
  GITHUB_CLIENT_ID: '',
  GITHUB_CLIENT_SECRET: '',
  GITHUB_REDIRECT_URI: '',
};

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const) {
  if (!env[k]) {
    console.error(`missing required env: ${k}`);
    process.exit(1);
  }
}

const BATCH    = Number(process.env.CRAWL_BATCH ?? 80);
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 12);
const INTERVAL_MS = Number(process.env.CRAWL_INTERVAL_MS ?? 30000);
const ONLY_USER   = process.env.CRAWL_USER_ID ?? null;

const UNCRAWLABLE_PREFIXES = ['image/', 'video/', 'audio/'] as const;
const UNCRAWLABLE_EXACT = new Set([
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

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...args: unknown[]) => console.log(`[${ts()}]`, ...args);

const listPendingUserIds = async (): Promise<string[]> => {
  if (ONLY_USER) return [ONLY_USER];
  const { data, error } = await supabase
    .from('files')
    .select('user_id')
    .is('content', null)
    .not('google_drive_id', 'is', null)
    .not('file_type', 'is', null);
  if (error) {
    log('list pending users failed:', error.message);
    return [];
  }
  return [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
};

const sweep = async (): Promise<{ totalCrawled: number; totalConns: number; usersDone: number }> => {
  const userIds = await listPendingUserIds();
  let totalCrawled = 0;
  let totalConns = 0;
  let usersDone = 0;

  for (const userId of userIds) {
    log(`user ${userId.slice(0, 8)}…  draining`);
    let safety = 1000;
    while (safety-- > 0) {
      try {
        const r = await crawler.runIncrementalCrawlBatch(supabase, userId, {
          batchSize: BATCH,
          concurrency: CONCURRENCY,
          isCrawlable,
          getAccessToken: () => getValidAccessToken(supabase, userId, env),
        });
        totalCrawled += r.crawled;
        totalConns   += r.connections;
        log(`  +${r.crawled} files, +${r.connections} conns, ${r.remaining} pending`);
        if (r.remaining === 0) break;
      } catch (err) {
        if (err instanceof Error && err.message === 'DRIVE_NOT_CONNECTED') {
          log(`  user has no Drive — skipping`);
          break;
        }
        log('  batch error:', err);
        break;
      }
    }
    usersDone++;
  }

  return { totalCrawled, totalConns, usersDone };
};

const main = async () => {
  log(`crawler CLI starting · batch=${BATCH} concurrency=${CONCURRENCY} interval=${INTERVAL_MS}ms`);
  if (ONLY_USER) log(`restricted to user ${ONLY_USER}`);

  while (true) {
    const t0 = Date.now();
    const r = await sweep();
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    log(`sweep done in ${dt}s · users=${r.usersDone} crawled=${r.totalCrawled} conns=${r.totalConns}`);
    if (r.totalCrawled === 0) {
      log(`idle — sleeping ${INTERVAL_MS}ms`);
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
  }
};

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});

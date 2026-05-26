# neural-network-crawler

Solo Cloudflare Worker for the crawl pipeline. Shares
`crawlerService` / `driveHelpers` / `jwtService` with the main backend via
relative imports (bundled by esbuild at deploy).

## Why split

Main API worker hits subrequest + CPU caps when crawling many files. Crawler
worker gets its own request budget per invocation, plus a cron trigger that
sweeps every user with pending content.

## Endpoints

- `GET  /health`            — liveness
- `POST /run`     [JWT]     — one batch (40 files), legacy compatible
- `POST /run-all` [JWT]     — first batch sync, rest via `ctx.waitUntil`
- `scheduled()`              — cron, sweeps all users with pending files

## Deploy

```bash
cd backend-crawler
npm install

# Set secrets (same values as main backend)
wrangler secret put SUPABASE_URL          --env production
wrangler secret put SUPABASE_SERVICE_KEY  --env production
wrangler secret put JWT_SECRET            --env production
wrangler secret put GOOGLE_CLIENT_ID      --env production
wrangler secret put GOOGLE_CLIENT_SECRET  --env production

npm run deploy:prod
```

Then point the frontend at it:

```
VITE_CRAWLER_URL=https://neural-network-crawler.<sub>.workers.dev
```

## Local dev

```bash
npm run dev          # http://localhost:8788
```

Test cron locally:

```bash
wrangler dev --test-scheduled --port 8788
curl http://localhost:8788/__scheduled
```

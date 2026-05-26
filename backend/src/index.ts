import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Env } from './types';
import apiRouter from './routes';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

app.use('*', async (c, next) => {
  const raw = (c.env.FRONTEND_URL || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const exact = new Set(raw.filter((o) => !o.startsWith('*.')));
  const suffixes = raw
    .filter((o) => o.startsWith('*.'))
    .map((o) => o.slice(1));

  const isAllowedOrigin = (origin: string): boolean => {
    if (exact.has(origin)) return true;
    try {
      const host = new URL(origin).hostname;
      return suffixes.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
    } catch {
      return false;
    }
  };

  const fallback = raw[0] ?? '*';

  return cors({
    origin: raw.length === 1 && raw[0] === '*'
      ? '*'
      : (origin) => (origin && isAllowedOrigin(origin) ? origin : fallback),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next);
});

app.use('*', logger());

app.get('/health', (c) => c.json({ success: true, message: 'Worker running' }));

app.route('/api', apiRouter);

app.notFound((c) => c.json({ success: false, message: 'Route not found' }, 404));

// Global error handler — without this, an uncaught throw bypasses the CORS
// middleware and Cloudflare returns a 503 with no Access-Control-Allow-Origin
// header, which the browser surfaces as a CORS error.
app.onError((err, c) => {
  console.error('[Unhandled]', c.req.path, err instanceof Error ? `${err.name}: ${err.message}` : err);
  return c.json({ success: false, message: 'Internal server error' }, 500);
});

export default app;

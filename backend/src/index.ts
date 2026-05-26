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
  const allowed = (c.env.FRONTEND_URL || '*')
    .split(',')
    .map((o) => o.trim());

  return cors({
    origin: allowed.length === 1 && allowed[0] === '*' ? '*' : (origin) =>
      allowed.includes(origin) ? origin : allowed[0],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next);
});

app.use('*', logger());

app.get('/health', (c) => c.json({ success: true, message: 'Worker running' }));

app.route('/api', apiRouter);

app.notFound((c) => c.json({ success: false, message: 'Route not found' }, 404));

export default app;

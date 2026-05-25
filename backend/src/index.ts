import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Env } from './types';
import apiRouter from './routes';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) =>
  cors({
    origin: c.env.FRONTEND_URL || '*',
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next)
);

app.use('*', logger());

app.get('/health', (c) => c.json({ success: true, message: 'Worker running' }));

app.route('/api', apiRouter);

app.notFound((c) => c.json({ success: false, message: 'Route not found' }, 404));

export default app;

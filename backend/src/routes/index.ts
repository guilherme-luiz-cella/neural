import { Hono } from 'hono';
import { Env } from '../types';
import authRouter from './auth';

const router = new Hono<{ Bindings: Env }>();

router.route('/auth', authRouter);

export default router;

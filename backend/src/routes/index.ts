import { Hono } from 'hono';
import { Env } from '../types';
import authRouter from './auth';
import authGoogleRouter from './authGoogle';
import driveRouter from './drive';
import filesRouter from './files';
import projectsRouter from './projects';
import crawlerRouter from './crawler';
import graphRouter from './graph';

const router = new Hono<{ Bindings: Env }>();

router.route('/auth', authRouter);
router.route('/auth/google', authGoogleRouter);
router.route('/drive', driveRouter);
router.route('/files', filesRouter);
router.route('/projects', projectsRouter);
router.route('/crawler', crawlerRouter);
router.route('/graph', graphRouter);

export default router;

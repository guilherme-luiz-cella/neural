import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { AppError, NotFoundError, ValidationError, ConflictError } from '../utils/errors';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

const onError = (err: unknown, c: Parameters<Parameters<typeof router.get>[1]>[0]) => {
  if (err instanceof AppError) {
    return c.json({ success: false, message: err.message }, err.statusCode as 400 | 401 | 404 | 409);
  }
  console.error('[Projects]', err);
  return c.json({ success: false, message: 'Internal server error' }, 500);
};

// GET /api/projects
router.get('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const { data, error } = await db(c)
      .from('projects')
      .select('id, name, description, color_tag, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return c.json({ success: true, message: 'Projects retrieved', data: { projects: data } });
  } catch (err) { return onError(err, c); }
});

// POST /api/projects
router.post('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const body = await c.req.json<{ name: string; description?: string; color_tag?: string }>();
    if (!body.name?.trim()) throw new ValidationError('name is required');
    if (body.color_tag && !/^#[0-9A-Fa-f]{6}$/.test(body.color_tag)) {
      throw new ValidationError('color_tag must be a valid hex color (e.g. #3B82F6)');
    }

    const { data, error } = await db(c)
      .from('projects')
      .insert({ user_id: userId, name: body.name.trim(), description: body.description, color_tag: body.color_tag })
      .select('id, name, description, color_tag, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') throw new ConflictError('A project with this name already exists');
      throw new Error(error.message);
    }
    return c.json({ success: true, message: 'Project created', data: { project: data } }, 201);
  } catch (err) { return onError(err, c); }
});

// PUT /api/projects/:id
router.put('/:id', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; description?: string; color_tag?: string | null }>();

    if (body.name !== undefined && !body.name?.trim()) throw new ValidationError('name cannot be empty');
    if (body.color_tag && !/^#[0-9A-Fa-f]{6}$/.test(body.color_tag)) {
      throw new ValidationError('color_tag must be a valid hex color');
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) update.name = body.name.trim();
    if ('description' in body) update.description = body.description;
    if ('color_tag' in body) update.color_tag = body.color_tag;

    const { data, error } = await db(c)
      .from('projects')
      .update(update)
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, name, description, color_tag, updated_at')
      .single();

    if (error || !data) throw new NotFoundError('Project not found');
    return c.json({ success: true, message: 'Project updated', data: { project: data } });
  } catch (err) { return onError(err, c); }
});

// DELETE /api/projects/:id
router.delete('/:id', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const id = c.req.param('id');

    const { error, count } = await db(c)
      .from('projects')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', userId);

    if (error || !count) throw new NotFoundError('Project not found');
    return c.json({ success: true, message: 'Project deleted' });
  } catch (err) { return onError(err, c); }
});

// GET /api/projects/:id/files
router.get('/:id/files', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const id = c.req.param('id');

    const { data: project } = await db(c)
      .from('projects')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!project) throw new NotFoundError('Project not found');

    const { data, error } = await db(c)
      .from('files')
      .select('id, file_name, file_type, google_drive_id, project_id, created_at, updated_at')
      .eq('user_id', userId)
      .eq('project_id', id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return c.json({ success: true, message: 'Project files retrieved', data: { files: data } });
  } catch (err) { return onError(err, c); }
});

// PUT /api/projects/:id/files/:fileId — assign file to project
router.put('/:id/files/:fileId', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const projectId = c.req.param('id');
    const fileId = c.req.param('fileId');

    const { data: project } = await db(c)
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!project) throw new NotFoundError('Project not found');

    const { data, error } = await db(c)
      .from('files')
      .update({ project_id: projectId, updated_at: new Date().toISOString() })
      .eq('id', fileId)
      .eq('user_id', userId)
      .select('id, file_name, project_id, updated_at')
      .single();

    if (error || !data) throw new NotFoundError('File not found');
    return c.json({ success: true, message: 'File assigned to project', data: { file: data } });
  } catch (err) { return onError(err, c); }
});

// DELETE /api/projects/:id/files/:fileId — remove file from project
router.delete('/:id/files/:fileId', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const projectId = c.req.param('id');
    const fileId = c.req.param('fileId');

    const { data, error } = await db(c)
      .from('files')
      .update({ project_id: null, updated_at: new Date().toISOString() })
      .eq('id', fileId)
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .select('id, file_name, project_id')
      .single();

    if (error || !data) throw new NotFoundError('File not found in this project');
    return c.json({ success: true, message: 'File removed from project', data: { file: data } });
  } catch (err) { return onError(err, c); }
});

export default router;

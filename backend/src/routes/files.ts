import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

const onError = (err: unknown, c: Parameters<Parameters<typeof router.get>[1]>[0]) => {
  if (err instanceof AppError) {
    return c.json({ success: false, message: err.message }, err.statusCode as 400 | 401 | 404 | 409);
  }
  console.error('[Files]', err);
  return c.json({ success: false, message: 'Internal server error' }, 500);
};

router.get('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const projectId = c.req.query('project_id');

    let query = db(c)
      .from('files')
      .select('id, file_name, file_type, google_drive_id, project_id, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (projectId) query = query.eq('project_id', projectId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return c.json({ success: true, message: 'Files retrieved', data: { files: data } });
  } catch (err) { return onError(err, c); }
});

router.get('/:id', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const id = c.req.param('id');
    const { data, error } = await db(c)
      .from('files')
      .select('id, file_name, file_type, google_drive_id, project_id, content, created_at, updated_at')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error || !data) throw new NotFoundError('File not found');
    return c.json({ success: true, message: 'File retrieved', data: { file: data } });
  } catch (err) { return onError(err, c); }
});

router.post('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const body = await c.req.json<{ file_name: string; file_type?: string; project_id?: string; content?: string }>();
    if (!body.file_name?.trim()) throw new ValidationError('file_name is required');

    const { data, error } = await db(c)
      .from('files')
      .insert({ user_id: userId, ...body })
      .select('id, file_name, file_type, project_id, created_at, updated_at')
      .single();

    if (error) throw new Error(error.message);
    return c.json({ success: true, message: 'File created', data: { file: data } }, 201);
  } catch (err) { return onError(err, c); }
});

router.put('/:id', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json<{ file_name?: string; content?: string; project_id?: string | null }>();

    const { data, error } = await db(c)
      .from('files')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, file_name, file_type, project_id, updated_at')
      .single();

    if (error || !data) throw new NotFoundError('File not found');
    return c.json({ success: true, message: 'File updated', data: { file: data } });
  } catch (err) { return onError(err, c); }
});

router.delete('/:id', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const id = c.req.param('id');

    const { error, count } = await db(c)
      .from('files')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', userId);

    if (error || !count) throw new NotFoundError('File not found');
    return c.json({ success: true, message: 'File deleted' });
  } catch (err) { return onError(err, c); }
});

export default router;

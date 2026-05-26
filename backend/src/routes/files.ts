import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { zipSync, strToU8 } from 'fflate';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { getValidAccessToken, validateUserGoogleAccount } from './driveHelpers';

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

// GET /api/files
router.get('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const projectId = c.req.query('project_id');

    let query = db(c)
      .from('files')
      .select('id, file_name, file_type, google_drive_id, github_repo, github_path, project_id, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (projectId) query = query.eq('project_id', projectId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return c.json({ success: true, message: 'Files retrieved', data: { files: data } });
  } catch (err) { return onError(err, c); }
});

// GET /api/files/:id
router.get('/:id', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const id = c.req.param('id');
    const { data, error } = await db(c)
      .from('files')
      .select('id, file_name, file_type, google_drive_id, github_repo, github_path, github_sha, project_id, content, created_at, updated_at')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error || !data) throw new NotFoundError('File not found');

    // If content is missing but we have a Drive file ID, try to fetch it
    if (!data.content && data.google_drive_id && data.file_type) {
      try {
        const { default: crawlerService } = await import('../services/crawlerService.ts');
        const supabase = db(c);
        const accessToken = await getValidAccessToken(supabase, userId, c.env);
        const fetchedContent = await crawlerService.fetchFileContent(data.google_drive_id, data.file_type, accessToken);
        if (fetchedContent) {
          // Update the file with fetched content
          await supabase.from('files').update({ content: fetchedContent }).eq('id', id);
          data.content = fetchedContent;
        }
      } catch {
        // If fetching fails, return what we have (content might be null)
      }
    }

    return c.json({ success: true, message: 'File retrieved', data: { file: data } });
  } catch (err) { return onError(err, c); }
});

// GET /api/files/:id/media — proxy Drive binary (images, video, audio < 20MB)
router.get('/:id/media', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const id = c.req.param('id');
    const supabase = db(c);

    const { data: file } = await supabase
      .from('files')
      .select('google_drive_id, file_type')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!file?.google_drive_id) return c.json({ success: false, message: 'No Drive file' }, 404);

    const accessToken = await getValidAccessToken(supabase, userId, c.env);
    await validateUserGoogleAccount(supabase, userId, accessToken);

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.google_drive_id}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!driveRes.ok) return c.json({ success: false, message: 'Drive fetch failed' }, 502);

    const body = await driveRes.arrayBuffer();
    const contentType = file.file_type ?? driveRes.headers.get('content-type') ?? 'application/octet-stream';

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) { return onError(err, c); }
});

// GET /api/files/:id/download — download single file
router.get('/:id/download', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const id = c.req.param('id');
    const { data: file, error } = await db(c)
      .from('files')
      .select('file_name, content, file_type')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error || !file) throw new NotFoundError('File not found');

    const content = file.content ?? '';
    return new Response(content, {
      headers: {
        'Content-Type': file.file_type ?? 'text/plain',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.file_name)}"`,
      },
    });
  } catch (err) { return onError(err, c); }
});

// POST /api/files/download-zip — bulk download as .zip
router.post('/download-zip', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const body = await c.req.json<{ file_ids?: string[]; project_id?: string }>();

    let query = db(c)
      .from('files')
      .select('file_name, content, project_id')
      .eq('user_id', userId);

    if (body.file_ids?.length) {
      query = query.in('id', body.file_ids);
    } else if (body.project_id) {
      query = query.eq('project_id', body.project_id);
    }

    const { data: files, error } = await query;
    if (error) throw new Error(error.message);
    if (!files?.length) return c.json({ success: false, message: 'No files' }, 404);

    const zipEntries: Record<string, Uint8Array> = {};
    for (const f of files) {
      const safeName = f.file_name.replace(/[/\\?%*:|"<>]/g, '_');
      zipEntries[safeName] = strToU8(f.content ?? '');
    }

    const zipped = zipSync(zipEntries, { level: 6 });

    return new Response(zipped, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="neural-network-export.zip"',
      },
    });
  } catch (err) { return onError(err, c); }
});

// POST /api/files
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

// PUT /api/files/:id
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

// DELETE /api/files/:id
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

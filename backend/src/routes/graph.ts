import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

// GET /api/graph — nodes (files) + links (connections) for force graph
router.get('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);

    const [filesRes, projectsRes, connectionsRes] = await Promise.all([
      supabase
        .from('files')
        .select('id, file_name, file_type, project_id')
        .eq('user_id', userId),
      supabase
        .from('projects')
        .select('id, name, color_tag')
        .eq('user_id', userId),
      supabase
        .from('connections')
        .select('id, file_1_id, file_2_id, similarity_score, connection_type')
        .in(
          'file_1_id',
          (await supabase.from('files').select('id').eq('user_id', userId)).data?.map((f) => f.id) ?? []
        ),
    ]);

    const files = filesRes.data ?? [];
    const projects = projectsRes.data ?? [];
    const connections = connectionsRes.data ?? [];

    const projectColorMap = new Map(projects.map((p) => [p.id, p.color_tag ?? '#6B7280']));

    const nodes = files.map((f) => ({
      id: f.id,
      name: f.file_name,
      file_type: f.file_type,
      project_id: f.project_id,
      color: f.project_id ? (projectColorMap.get(f.project_id) ?? '#6B7280') : '#374151',
      group: f.project_id ?? 'unassigned',
    }));

    const fileIds = new Set(files.map((f) => f.id));
    const links = connections
      .filter((conn) => fileIds.has(conn.file_1_id) && fileIds.has(conn.file_2_id))
      .map((conn) => ({
        source: conn.file_1_id,
        target: conn.file_2_id,
        value: conn.similarity_score ?? 0.5,
        type: conn.connection_type,
      }));

    return c.json({
      success: true,
      message: 'Graph data retrieved',
      data: { nodes, links, projects },
    });
  } catch (err) {
    console.error('[Graph]', err);
    return c.json({ success: false, message: 'Failed to fetch graph data' }, 500);
  }
});

export default router;

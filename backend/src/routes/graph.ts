import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

// GET /api/graph
router.get('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);

    const [filesRes, projectsRes, settingsRes] = await Promise.all([
      supabase.from('files').select('id, file_name, file_type, project_id, drive_path, github_repo').eq('user_id', userId),
      supabase.from('projects').select('id, name, color_tag').eq('user_id', userId),
      supabase.from('user_settings').select('enable_semantic_matching').eq('user_id', userId).single(),
    ]);

    const files = filesRes.data ?? [];
    const projects = projectsRes.data ?? [];
    const settings = settingsRes.data ?? { enable_semantic_matching: true };

    const fileIds = files.map((f) => f.id);

    const connectionsRes = fileIds.length
      ? await supabase
          .from('connections')
          .select('file_1_id, file_2_id, similarity_score, connection_type')
          .in('file_1_id', fileIds)
      : { data: [] };

    const dbConnections = connectionsRes.data ?? [];
    const fileIdSet = new Set(fileIds);

    // Build node list. Cluster files first by project, then by Drive top-level
    // folder, then by GitHub repo, falling back to "unassigned" so disparate
    // sources don't all collapse into one blob.
    const projectColorMap = new Map(projects.map((p) => [p.id, p.color_tag ?? '#6B7280']));

    const PALETTE = ['#60A5FA', '#A78BFA', '#34D399', '#FBBF24', '#F87171', '#F472B6', '#22D3EE', '#FB923C', '#A3E635', '#E879F9'];
    const hashColor = (key: string): string => {
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffffffff;
      return PALETTE[Math.abs(h) % PALETTE.length];
    };

    const deriveGroup = (f: typeof files[number]): { id: string; label: string; color: string } => {
      if (f.project_id) {
        return {
          id: f.project_id,
          label: f.project_id,
          color: projectColorMap.get(f.project_id) ?? '#6B7280',
        };
      }
      const drive = (f as { drive_path?: string | null }).drive_path;
      if (drive) {
        const top = drive.split('/').filter(Boolean)[0];
        if (top) {
          const key = `drive:${top}`;
          return { id: key, label: top, color: hashColor(key) };
        }
      }
      const repo = (f as { github_repo?: string | null }).github_repo;
      if (repo) {
        const key = `gh:${repo}`;
        return { id: key, label: repo, color: hashColor(key) };
      }
      return { id: 'unassigned', label: 'Unassigned', color: '#4B5563' };
    };

    const groupInfo = new Map<string, { label: string; color: string }>();
    const nodes = files.map((f) => {
      const g = deriveGroup(f);
      if (!groupInfo.has(g.id)) groupInfo.set(g.id, { label: g.label, color: g.color });
      return {
        id: f.id,
        name: f.file_name,
        file_type: f.file_type,
        project_id: f.project_id,
        drive_path: (f as { drive_path?: string | null }).drive_path ?? null,
        github_repo: (f as { github_repo?: string | null }).github_repo ?? null,
        color: g.color,
        group: g.id,
      };
    });

    const syntheticGroups = [...groupInfo.entries()]
      .filter(([id]) => !projectColorMap.has(id) && id !== 'unassigned')
      .map(([id, info]) => ({ id, name: info.label, color_tag: info.color }));

    // Subject (TF-IDF) links from crawler-produced connections only.
    const subjectLinks = settings.enable_semantic_matching
      ? dbConnections
          .filter((c) => c.connection_type === 'semantic' && fileIdSet.has(c.file_1_id) && fileIdSet.has(c.file_2_id) && (c.similarity_score ?? 0) >= 0.1)
          .map((c) => ({
            source: c.file_1_id,
            target: c.file_2_id,
            value: Math.round((c.similarity_score ?? 0.1) * 100) / 100,
            type: 'semantic',
          }))
      : [];

    return c.json({
      success: true,
      message: 'Graph data retrieved',
      data: {
        nodes,
        links: subjectLinks,
        projects: [...projects, ...syntheticGroups],
      },
    });
  } catch (err) {
    console.error('[Graph]', err);
    return c.json({ success: false, message: 'Failed to fetch graph data' }, 500);
  }
});

export default router;

import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Env } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { NotFoundError } from '../utils/errors';

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const router = new Hono<AppEnv>();
const db = (c: { env: Env }) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);

const onError = (err: unknown, c: Parameters<Parameters<typeof router.get>[1]>[0]) => {
  console.error('[Settings]', err);
  return c.json({ success: false, message: 'Settings error' }, 500);
};

// GET /api/settings — get user settings
router.get('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const { data, error } = await db(c)
      .from('user_settings')
      .select('enable_semantic_matching, enable_name_matching')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    // Return defaults if no settings exist
    const settings = data || {
      enable_semantic_matching: true,
      enable_name_matching: true,
    };

    return c.json({ success: true, message: 'Settings retrieved', data: settings });
  } catch (err) {
    return onError(err, c);
  }
});

// PUT /api/settings — update user settings
router.put('/', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const body = await c.req.json<{
      enable_semantic_matching?: boolean;
      enable_name_matching?: boolean;
    }>();

    const supabase = db(c);

    // Check if settings exist for this user
    const { data: existing } = await supabase
      .from('user_settings')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    let result;
    if (existing) {
      // Update existing
      result = await supabase
        .from('user_settings')
        .update({
          ...body,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select();
    } else {
      // Insert new
      result = await supabase
        .from('user_settings')
        .insert({
          user_id: userId,
          enable_semantic_matching: body.enable_semantic_matching ?? true,
          enable_name_matching: body.enable_name_matching ?? true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select();
    }

    if (result.error) throw new Error(result.error.message);
    if (!result.data?.[0]) throw new NotFoundError('Failed to update settings');

    return c.json({
      success: true,
      message: 'Settings updated',
      data: result.data[0],
    });
  } catch (err) {
    return onError(err, c);
  }
});

// PUT /api/settings/semantic — toggle semantic matching
router.put('/toggle/semantic', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);

    const { data: existing } = await supabase
      .from('user_settings')
      .select('enable_semantic_matching')
      .eq('user_id', userId)
      .maybeSingle();

    const newValue = existing ? !existing.enable_semantic_matching : false;

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: userId,
          enable_semantic_matching: newValue,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select();

    if (error) throw new Error(error.message);

    return c.json({
      success: true,
      message: `Semantic matching ${newValue ? 'enabled' : 'disabled'}`,
      data: { enable_semantic_matching: newValue },
    });
  } catch (err) {
    return onError(err, c);
  }
});

// PUT /api/settings/toggle/name — toggle name matching
router.put('/toggle/name', authMiddleware, async (c) => {
  try {
    const { userId } = c.get('user');
    const supabase = db(c);

    const { data: existing } = await supabase
      .from('user_settings')
      .select('enable_name_matching')
      .eq('user_id', userId)
      .maybeSingle();

    const newValue = existing ? !existing.enable_name_matching : false;

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: userId,
          enable_name_matching: newValue,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select();

    if (error) throw new Error(error.message);

    return c.json({
      success: true,
      message: `Name matching ${newValue ? 'enabled' : 'disabled'}`,
      data: { enable_name_matching: newValue },
    });
  } catch (err) {
    return onError(err, c);
  }
});

export default router;

import { createMiddleware } from 'hono/factory';
import { Env, JwtPayload } from '../types';
import { verifyToken } from '../services/jwtService';

export type AuthVariables = { user: JwtPayload };

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, message: 'Authorization token required' }, 401);
  }

  try {
    const payload = await verifyToken(authHeader.substring(7), c.env.JWT_SECRET);
    if (payload.type !== 'access') {
      console.warn('[Auth] wrong token type', { type: payload.type, path: c.req.path });
      return c.json({ success: false, message: 'Invalid token type' }, 401);
    }
    c.set('user', payload);
    await next();
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn('[Auth] verifyToken failed', { reason, path: c.req.path });
    return c.json({ success: false, message: 'Invalid or expired token' }, 401);
  }
});

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
  created_at: string;
  updated_at: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

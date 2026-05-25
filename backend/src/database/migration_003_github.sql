-- Run in Supabase SQL Editor

-- GitHub OAuth token storage
CREATE TABLE IF NOT EXISTS github_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  scope TEXT,
  github_username TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Track GitHub file origin for push-back
ALTER TABLE files ADD COLUMN IF NOT EXISTS github_repo TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS github_path TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS github_sha  TEXT;

CREATE INDEX IF NOT EXISTS idx_github_auth_user_id ON github_auth(user_id);

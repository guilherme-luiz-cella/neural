-- Run in Supabase SQL Editor
-- Adds columns/tables referenced by drive.ts, driveHelpers.ts, files.ts but missing from prior schema.

-- 1. Drive account email (referenced in drive.ts and driveHelpers.ts)
ALTER TABLE google_drive_auth
  ADD COLUMN IF NOT EXISTS google_account_email TEXT;

-- 2. GitHub columns on files (in case migration_003 was not applied)
ALTER TABLE files ADD COLUMN IF NOT EXISTS github_repo TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS github_path TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS github_sha  TEXT;

-- 3. Sessions table (referenced in driveHelpers.ts on ACCOUNT_MISMATCH_LOGOUT)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token  ON sessions(token);

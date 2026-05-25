-- Run in Supabase SQL Editor

-- Fix 1: file_type VARCHAR(50) too short for Google Drive MIME types
-- e.g. application/vnd.openxmlformats-officedocument.wordprocessingml.document = 71 chars
ALTER TABLE files ALTER COLUMN file_type TYPE TEXT;

-- Fix 2: Allow Google OAuth users (no password_hash)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

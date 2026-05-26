-- Run in Supabase SQL Editor
-- Stores Drive folder path so FileExplorer can nest Drive files.

ALTER TABLE files ADD COLUMN IF NOT EXISTS drive_path TEXT;

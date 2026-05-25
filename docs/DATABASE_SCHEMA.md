# Database Schema

Provider: Supabase (PostgreSQL)
Schema file: `backend/src/database/schema.sql`

## Setup

1. Create project at supabase.com
2. Enable pgvector: Dashboard → Database → Extensions → enable **vector**
3. Run schema SQL in Dashboard → SQL Editor
4. Copy connection string to `backend/.env` as `DATABASE_URL`

## Tables

| Table | Purpose |
|-------|---------|
| `users` | Auth accounts |
| `projects` | File groupings/themes |
| `files` | File metadata + content |
| `connections` | Graph edges between files |
| `google_drive_auth` | OAuth tokens per user |
| `file_embeddings` | Vector embeddings for similarity (Phase 4) |
| `crawler_jobs` | Background indexing job tracking (Phase 4) |

## Key Relationships

```
users ──< projects
users ──< files
projects ──< files
files ──< connections (file_1_id, file_2_id)
users ──| google_drive_auth (1:1)
files ──| file_embeddings (1:1)
users ──< crawler_jobs
```

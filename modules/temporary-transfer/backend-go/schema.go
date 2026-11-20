package main

const schema = `CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
        text_content TEXT, code_salt TEXT NOT NULL, code_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        revoked_at INTEGER, max_grants INTEGER, grant_count INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'ready', exhausted_at INTEGER,
        content_kind TEXT NOT NULL DEFAULT 'text', file_total INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS transfers_owner_created ON transfers(owner_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES transfers(id),
        object_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, size INTEGER NOT NULL,
        upload_id TEXT, state TEXT NOT NULL DEFAULT 'pending',
        cleanup_attempts INTEGER NOT NULL DEFAULT 0, cleanup_last_at INTEGER,
        storage_backend TEXT NOT NULL DEFAULT 'r2'
      );
      CREATE INDEX IF NOT EXISTS files_transfer ON files(transfer_id);
    `

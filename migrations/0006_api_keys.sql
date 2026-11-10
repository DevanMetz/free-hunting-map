CREATE TABLE api_keys (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, prefix TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT 'read', created_at INTEGER NOT NULL, last_used_at INTEGER);
CREATE INDEX api_keys_user ON api_keys(user_id);
CREATE INDEX items_user_kind ON items(user_id, kind, deleted, id);
CREATE INDEX community_hikes_bbox ON community_hikes(west, east, south, north);

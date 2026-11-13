-- Private hunting parties and the delayed public activity grid.
-- Party secrets are stored only as SHA-256. Activity rows are grid cells, never points or accounts.
CREATE TABLE scout_groups (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE scout_items (
  group_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  updated_at REAL NOT NULL,
  deleted INTEGER NOT NULL,
  payload TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (group_id, id)
);
CREATE TABLE scout_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  mutation TEXT NOT NULL UNIQUE,
  group_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX scout_changes_group_seq ON scout_changes(group_id, seq);
CREATE TABLE activity_hits (
  id TEXT PRIMARY KEY,
  cell TEXT NOT NULL,
  available_at INTEGER NOT NULL
);
CREATE TABLE activity_tiles (
  tile TEXT NOT NULL,
  hit_id TEXT NOT NULL,
  PRIMARY KEY (tile, hit_id)
);
CREATE INDEX activity_hits_ready ON activity_hits(available_at);

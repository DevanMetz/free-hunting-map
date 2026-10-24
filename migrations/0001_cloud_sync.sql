CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, mutation TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX changes_user_seq ON changes(user_id, seq);
CREATE TABLE items (user_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, updated_at REAL NOT NULL, deleted INTEGER NOT NULL, payload TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(user_id,id));
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);

CREATE TABLE community_scans (hash TEXT PRIMARY KEY, day TEXT NOT NULL, model TEXT NOT NULL, area TEXT NOT NULL, line_count INTEGER NOT NULL, threshold REAL, sources TEXT NOT NULL, raw_key TEXT NOT NULL);
CREATE TABLE community_lines (id TEXT PRIMARY KEY, geometry TEXT NOT NULL, west REAL NOT NULL, south REAL NOT NULL, east REAL NOT NULL, north REAL NOT NULL, scan_count INTEGER NOT NULL, model TEXT NOT NULL, confidence REAL NOT NULL, first_seen TEXT NOT NULL, last_confirmed TEXT NOT NULL, real_votes INTEGER NOT NULL DEFAULT 0, not_votes INTEGER NOT NULL DEFAULT 0, override TEXT CHECK(override IN ('show','hide')));
CREATE INDEX community_bbox ON community_lines(west,east,south,north);
CREATE TABLE community_tiles (tile TEXT NOT NULL, line_id TEXT NOT NULL REFERENCES community_lines(id) ON DELETE CASCADE, PRIMARY KEY(tile,line_id));
CREATE TABLE community_revision (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO community_revision VALUES(1,0);

/* Votes and training survive display-layer deletion. */
CREATE TABLE community_votes (line_id TEXT NOT NULL, device_hash TEXT NOT NULL, vote TEXT, type TEXT, at TEXT NOT NULL, PRIMARY KEY(line_id,device_hash));
CREATE TABLE community_vote_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, line_id TEXT NOT NULL, device_hash TEXT NOT NULL, vote TEXT, type TEXT, at TEXT NOT NULL);
CREATE INDEX community_vote_history ON community_vote_log(line_id,seq);

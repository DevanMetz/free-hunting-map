CREATE TABLE community_scans (hash TEXT PRIMARY KEY, day TEXT NOT NULL, model TEXT NOT NULL, area TEXT NOT NULL, line_count INTEGER NOT NULL);
CREATE TABLE community_lines (id TEXT PRIMARY KEY, geometry TEXT NOT NULL, west REAL NOT NULL, south REAL NOT NULL, east REAL NOT NULL, north REAL NOT NULL, scan_count INTEGER NOT NULL, model TEXT NOT NULL, confidence REAL NOT NULL, first_seen TEXT NOT NULL, last_confirmed TEXT NOT NULL);
CREATE INDEX community_bbox ON community_lines(west,east,south,north);
CREATE TABLE community_tiles (tile TEXT NOT NULL, line_id TEXT NOT NULL REFERENCES community_lines(id) ON DELETE CASCADE, PRIMARY KEY(tile,line_id));
CREATE TABLE community_revision (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO community_revision VALUES(1,0);

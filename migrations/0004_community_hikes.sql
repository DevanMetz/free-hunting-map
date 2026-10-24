/* Withdrawals retain only replay protection and report history, never training geometry. */
CREATE TABLE community_hikes (
 id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, content_hash TEXT UNIQUE,
 geometry TEXT, month TEXT, name TEXT, type TEXT, distance INTEGER,
 west REAL, south REAL, east REAL, north REAL,
 withdrawn INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
 reports INTEGER NOT NULL DEFAULT 0, override TEXT CHECK(override IN ('show','hide'))
);
CREATE TABLE community_hike_tiles (tile TEXT NOT NULL, hike_id TEXT NOT NULL, PRIMARY KEY(tile,hike_id));
CREATE INDEX community_hike_tile_id ON community_hike_tiles(hike_id);
CREATE TABLE community_hike_reports (hike_id TEXT NOT NULL, device_hash TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(hike_id,device_hash));
CREATE TABLE community_hike_report_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, hike_id TEXT NOT NULL, device_hash TEXT NOT NULL, at TEXT NOT NULL);

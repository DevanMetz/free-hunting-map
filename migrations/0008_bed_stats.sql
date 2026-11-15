-- Anonymous bedding terrain. A row is aspect, slope position, openness and steepness
-- plus a state code and terrain type. No coordinates, accounts, or device ids.
CREATE TABLE bed_stats (
  id TEXT PRIMARY KEY,
  terrain TEXT NOT NULL,
  region TEXT NOT NULL,
  aspect INTEGER NOT NULL,
  position INTEGER NOT NULL,
  openness INTEGER NOT NULL,
  steepness INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX bed_stats_lookup ON bed_stats(region, terrain, created_at);

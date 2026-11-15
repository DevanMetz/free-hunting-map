import { ApiError } from './sync';

const TERRAIN = new Set(['hill', 'flat', 'farm', 'piedmont', 'mountain']);

interface StatRow { aspect: number; position: number; openness: number; steepness: number }

export async function readBedStats(db: D1Database, url: URL): Promise<Response> {
  const region = url.searchParams.get('region') ?? '';
  const terrain = url.searchParams.get('terrain') ?? '';
  if (!/^[A-Z]{2}$/.test(region) || !TERRAIN.has(terrain)) throw new ApiError(400, 'Invalid bedding query');
  const rows = await db.prepare(
    'SELECT aspect, position, openness, steepness FROM bed_stats WHERE region=? AND terrain=? ORDER BY created_at DESC LIMIT 8000',
  ).bind(region, terrain).all<StatRow>();
  const list = rows.results;
  const headers = { 'Cache-Control': 'public, max-age=3600' };
  if (list.length < 12) return Response.json({ n: list.length }, { headers });
  const arc = aspectArc(list.map(row => row.aspect));
  return Response.json({
    n: list.length,
    aspectStart: arc.start,
    aspectEnd: arc.end,
    aspectSpan: arc.span,
    position: [percentile(list.map(row => row.position), 0.2), percentile(list.map(row => row.position), 0.8)],
    openness: [tenth(list.map(row => row.openness), 0.2), tenth(list.map(row => row.openness), 0.8)],
    steepness: [tenth(list.map(row => row.steepness), 0.2), tenth(list.map(row => row.steepness), 0.8)],
  }, { headers });
}

export async function writeBedStats(db: D1Database, raw: unknown): Promise<Response> {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { stats?: unknown }).stats)) throw new ApiError(400, 'Invalid bedding stats');
  const stats = (raw as { stats: unknown[] }).stats;
  if (!stats.length || stats.length > 40) throw new ApiError(400, 'Invalid bedding stats');
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const row of stats) {
    if (!row || typeof row !== 'object') throw new ApiError(400, 'Invalid bedding stats');
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || !/^[0-9a-f]{32}$/.test(record.id)) throw new ApiError(400, 'Invalid bedding stats');
    if (typeof record.terrain !== 'string' || !TERRAIN.has(record.terrain)) throw new ApiError(400, 'Invalid bedding stats');
    if (typeof record.region !== 'string' || !/^[A-Z]{2}$/.test(record.region)) throw new ApiError(400, 'Invalid bedding stats');
    const aspect = integer(record.aspect, 0, 359);
    const position = integer(record.position, 0, 100);
    const openness = integer(record.openness, 400, 1300);
    const steepness = integer(record.steepness, 0, 900);
    if (aspect === null || position === null || openness === null || steepness === null) throw new ApiError(400, 'Invalid bedding stats');
    statements.push(db.prepare(
      'INSERT OR IGNORE INTO bed_stats (id, terrain, region, aspect, position, openness, steepness, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).bind(record.id, record.terrain, record.region, aspect, position, openness, steepness, now));
  }
  await db.batch(statements);
  return Response.json({ accepted: statements.length }, { headers: { 'Cache-Control': 'no-store' } });
}

function integer(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))]!;
}

function tenth(values: number[], p: number): number {
  return Math.round(percentile(values, p)) / 10;
}

function aspectArc(aspects: number[]): { start: number; end: number; span: number } {
  const bins = new Array<number>(36).fill(0);
  for (const aspect of aspects) bins[Math.min(35, Math.floor((((aspect % 360) + 360) % 360) / 10))]!++;
  const need = Math.ceil(aspects.length * 0.7);
  let bestStart = 0;
  let bestLen = 36;
  for (let start = 0; start < 36; start++) {
    let count = 0;
    for (let len = 1; len <= 36; len++) {
      count += bins[(start + len - 1) % 36]!;
      if (count < need) continue;
      if (len < bestLen) { bestLen = len; bestStart = start; }
      break;
    }
  }
  const start = bestStart * 10;
  const end = (bestStart + bestLen) * 10 % 360;
  return { start, end: end === 0 ? 359 : end, span: bestLen * 10 };
}

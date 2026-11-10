import { operations } from './v1Ops';
import { limitBinding, readJson, V1Error, type ApiKeyRow, type V1Ctx, type V1Env } from './v1Shared';

const VERSIONS = new Set(['2025-06-18', '2025-03-26']);
const collectionSchema = { type: 'object', properties: { bbox: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, updated_since: { type: 'string' }, category: { type: 'string' }, geometry: { type: 'string', enum: ['simplified', 'full', 'none'] } } };
const TOOLS: { name: string; op: string; description: string; auth: 'key' | 'optional'; schema: Record<string, unknown> }[] = [
  { name: 'terrain_point', op: 'terrain_point', description: 'Elevation, slope and aspect at a WGS84 point', auth: 'optional', schema: { type: 'object', required: ['lat', 'lng'], properties: { lat: { type: 'number' }, lng: { type: 'number' } } } },
  { name: 'terrain_profile', op: 'terrain_profile', description: 'Elevation profile along lng,lat;lng,lat or a GeoJSON LineString', auth: 'optional', schema: { type: 'object', properties: { path: { type: 'string' }, geometry: { type: 'object' }, samples: { type: 'integer' } } } },
  { name: 'terrain_summary', op: 'terrain_summary', description: 'Terrain statistics for a bbox of at most 0.25 degrees per side', auth: 'optional', schema: { type: 'object', required: ['bbox'], properties: { bbox: { type: 'string' } } } },
  { name: 'land_point', op: 'land_point', description: 'Public land, surface management, PLSS and parcel at a point', auth: 'optional', schema: { type: 'object', required: ['lat', 'lng'], properties: { lat: { type: 'number' }, lng: { type: 'number' }, include: { type: 'string' } } } },
  { name: 'land_area', op: 'land_area', description: 'Public land units intersecting a bbox', auth: 'optional', schema: { type: 'object', required: ['bbox'], properties: { bbox: { type: 'string' } } } },
  { name: 'land_path', op: 'land_path', description: 'Public land units crossed by lng,lat;lng,lat', auth: 'optional', schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } },
  { name: 'list_layers', op: 'list_layers', description: 'Map layer catalog and TileJSON URLs', auth: 'optional', schema: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } } },
  { name: 'community_trails', op: 'community_trails', description: 'Community lidar trails by bbox, or one trail by id', auth: 'optional', schema: { type: 'object', properties: { bbox: { type: 'string' }, id: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' } } } },
  { name: 'community_hikes', op: 'community_hikes', description: 'Community hikes by bbox, or one hike by id', auth: 'optional', schema: { type: 'object', properties: { bbox: { type: 'string' }, id: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' } } } },
  { name: 'me_summary', op: 'me_summary', description: 'Key info and synced item counts', auth: 'key', schema: { type: 'object', properties: {} } },
  { name: 'me_pins', op: 'me_pins', description: 'Synced waypoints', auth: 'key', schema: collectionSchema },
  { name: 'me_trails', op: 'me_trails', description: 'Synced drawn tracks', auth: 'key', schema: collectionSchema },
  { name: 'me_recordings', op: 'me_recordings', description: 'Synced GPS recordings', auth: 'key', schema: collectionSchema },
  { name: 'me_item', op: 'me_item', description: 'One synced pin or track', auth: 'key', schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'me_lidar_scans', op: 'me_lidar_scans', description: 'Synced lidar scan summaries', auth: 'key', schema: { type: 'object', properties: { bbox: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' } } } },
  { name: 'me_lidar_scan', op: 'me_lidar_scan', description: 'Candidates for one lidar scan', auth: 'key', schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'me_categories', op: 'me_categories', description: 'Synced categories', auth: 'key', schema: { type: 'object', properties: {} } },
];

function rpc(id: unknown, result: unknown) { return { jsonrpc: '2.0', id: id ?? null, result }; }
function rpcError(id: unknown, code: number, message: string) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; }
function toolError(message: string, code = 'invalid_request') {
  return { content: [{ type: 'text', text: message }], structuredContent: { error: { code, message } }, isError: true };
}

export async function handleMcp(request: Request, env: V1Env, exec: Pick<ExecutionContext, 'waitUntil'> | undefined, key: ApiKeyRow | null, url: URL): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  const limit = () => limitBinding(key ? env.RL_KEY : env.RL_ANON, key?.id ?? request.headers.get('CF-Connecting-IP') ?? 'local');
  let payload: unknown;
  try { payload = await readJson(request, 1_000_000); }
  catch { await limit(); return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400 }); }
  const batch = Array.isArray(payload);
  const messages: unknown[] = batch ? payload as unknown[] : [payload];
  if (!messages.length || messages.length > 20) { await limit(); return Response.json(rpcError(null, -32600, 'Invalid request'), { status: 400 }); }
  const responses = [];
  for (const message of messages) {
    const response = await one(message, request, env, exec, key, url, limit);
    if (response) responses.push(response);
  }
  if (!responses.length) return new Response(null, { status: 202 });
  return Response.json(batch ? responses : responses[0]);
}

async function one(message: unknown, request: Request, env: V1Env, exec: Pick<ExecutionContext, 'waitUntil'> | undefined, key: ApiKeyRow | null, url: URL, limit: () => Promise<void>) {
  const msg = message as { jsonrpc?: unknown; method?: unknown; id?: unknown; params?: unknown } | null;
  if (msg && typeof msg === 'object' && msg.method === 'notifications/initialized') return null;
  await limit();
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError((message as { id?: unknown } | null)?.id ?? null, -32600, 'Invalid request');
  const notify = !Object.hasOwn(msg, 'id');
  if (msg.method === 'initialize') {
    if (notify) return null;
    const requested = (msg.params as { protocolVersion?: unknown } | null)?.protocolVersion;
    return rpc(msg.id, { protocolVersion: typeof requested === 'string' && VERSIONS.has(requested) ? requested : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'free-hunting-map', version: '1' } });
  }
  if (msg.method === 'ping') return notify ? null : rpc(msg.id, {});
  if (msg.method === 'tools/list') return rpc(msg.id, { tools: TOOLS.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.schema })) });
  if (msg.method === 'tools/call') {
    const params = msg.params as { name?: unknown; arguments?: unknown } | null;
    const tool = TOOLS.find(item => item.name === params?.name);
    if (!tool || typeof params?.name !== 'string') return rpc(msg.id, toolError('Unknown tool'));
    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {};
    if (tool.auth === 'key' && !key) return rpc(msg.id, toolError('API key required', 'unauthorized'));
    try { return rpc(msg.id, await toolResult(tool, args, request, env, exec, key, url)); }
    catch (error) { if (error instanceof V1Error) return rpc(msg.id, toolError(error.message, error.code)); throw error; }
  }
  return notify ? null : rpcError(msg.id, -32601, 'Method not found');
}

async function toolResult(tool: typeof TOOLS[number], args: Record<string, unknown>, request: Request, env: V1Env, exec: Pick<ExecutionContext, 'waitUntil'> | undefined, key: ApiKeyRow | null, url: URL) {
  const opId = tool.name === 'community_trails' && args.id ? 'community_trail' : tool.name === 'community_hikes' && args.id ? 'community_hike' : tool.name === 'terrain_profile' && args.geometry ? 'terrain_profile_post' : tool.op;
  const op = operations.find(item => item.id === opId);
  if (!op) throw new V1Error(400, 'invalid_request', 'Unknown tool');
  const search = new URLSearchParams();
  for (const name of ['lat', 'lng', 'path', 'bbox', 'include', 'samples', 'limit', 'cursor', 'updated_since', 'category', 'geometry']) {
    if (args[name] != null) search.set(name, String(args[name]));
  }
  const ctx: V1Ctx = {
    request, url, env, exec, key, search, params: typeof args.id === 'string' ? { id: args.id } : {},
    body: args.geometry ? { geometry: args.geometry, samples: args.samples } : null,
  };
  const value = await op.handler(ctx);
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false };
}

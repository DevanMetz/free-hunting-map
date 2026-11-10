import { operations } from './v1Ops';

const examples: Record<string, unknown> = {
  terrain_point: { location: [-90.6, 44.75], elevation_m: 352.4, elevation_ft: 1156, slope_deg: 6.1, slope_pct: 10.7, aspect_deg: 214, aspect: 'SW', cell_size_m: 10, source: 'USGS 3DEP', license: 'public domain' },
  terrain_profile: { distance_m: 1935, min_m: 340.2, max_m: 371.9, gain_m: 38, loss_m: 12, samples: [{ d: 0, lng: -90.6, lat: 44.75, elevation_m: 352.4 }, { d: 645, lng: -90.593333, lat: 44.753333, elevation_m: 340.2 }], source: 'USGS 3DEP', license: 'public domain' },
  terrain_summary: { bbox: [-90.62, 44.74, -90.6, 44.76], grid: [16, 16], cell_size_m: 148, elevation: { min_m: 331, max_m: 389, mean_m: 356, relief_m: 58, high_point: [-90.6113, 44.7547], low_point: [-90.6187, 44.7413] }, slope: { mean_deg: 4.2, max_deg: 17.9, share: { '0-5': 0.61, '5-15': 0.33, '15-30': 0.06, '30+': 0 } }, aspect_share: { N: 0.1, NE: 0.08, E: 0.12, SE: 0.15, S: 0.2, SW: 0.17, W: 0.1, NW: 0.08 }, source: 'USGS 3DEP', license: 'public domain' },
};

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of operations) {
    const item = paths[op.path] ??= {};
    item[op.method.toLowerCase()] = {
      operationId: op.id, summary: op.summary, security: op.auth === 'key' ? [{ bearer: [] }] : [],
      parameters: op.params.map(param => ({ name: param.name, in: param.in, required: param.required ?? false, description: param.description, schema: param.schema })),
      ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: op.body.schema } } } } : {}),
      responses: {
        '200': { description: 'OK', content: { 'application/json': examples[op.id] ? { example: examples[op.id] } : { schema: { type: 'object' } } } },
        '401': { description: 'API key required or invalid' },
        '404': { description: 'Not found or no elevation data' },
        '422': { description: 'Outside supported US coverage' },
        '429': { description: 'Rate limited' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Free Hunting Map', version: '1',
      description: 'Read-only API for terrain, public land, community trails and hikes, and the signed-in account’s synced map data. /me returns only data synced while signed in. Attribute USGS 3DEP, PAD-US, BLM and the parcel source named on each land response.',
    },
    servers: [{ url: '/api/v1' }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Personal key, fhm_ plus 64 hex characters' } } },
    paths,
  };
}

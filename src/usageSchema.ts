export const FEATURES = ['layer_toggle','basemap_change','marker_add','track_record','offline_download','trail_scan','takeout_import','gpx_import','geojson_import','gpx_export','geojson_export','qr_share','search','sign_in','sync'] as const;
export type Feature = typeof FEATURES[number];
export function periods(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return { week: date.toISOString().slice(0,10), month: day.slice(0,7) };
}

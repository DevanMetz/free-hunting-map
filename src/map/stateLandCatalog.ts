/** Coverage for the hosted state-land tiles. `parcels` is the statewide situation, not a permission to hunt. */
export interface StateLandRecord {
  st: string;
  name: string;
  /** yes: statewide parcels are in the app. partial: only some counties. no: this state is public land only. */
  parcels: 'yes' | 'partial' | 'no';
  /** hosted: copied into state-land tiles. live: an existing query layer. none: no openly licensed statewide layer. */
  parcelLayer: 'hosted' | 'live' | 'none';
  note?: string;
}

export const STATE_LAND: readonly StateLandRecord[] = [
  { st: 'AL', name: 'Alabama', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'AK', name: 'Alaska', parcels: 'no', parcelLayer: 'none', note: 'No statewide parcel layer; borough data only.' },
  { st: 'AZ', name: 'Arizona', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'AR', name: 'Arkansas', parcels: 'yes', parcelLayer: 'live' },
  { st: 'CA', name: 'California', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'CO', name: 'Colorado', parcels: 'yes', parcelLayer: 'live' },
  { st: 'CT', name: 'Connecticut', parcels: 'yes', parcelLayer: 'live' },
  { st: 'DE', name: 'Delaware', parcels: 'yes', parcelLayer: 'live' },
  { st: 'DC', name: 'District of Columbia', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer added.' },
  { st: 'FL', name: 'Florida', parcels: 'yes', parcelLayer: 'live' },
  { st: 'GA', name: 'Georgia', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'HI', name: 'Hawaii', parcels: 'yes', parcelLayer: 'hosted', note: 'Hawaii Statewide GIS TMK parcels, public domain. Owner names are not in the layer.' },
  { st: 'ID', name: 'Idaho', parcels: 'partial', parcelLayer: 'live', note: 'Participating counties only.' },
  { st: 'IL', name: 'Illinois', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'IN', name: 'Indiana', parcels: 'yes', parcelLayer: 'live' },
  { st: 'IA', name: 'Iowa', parcels: 'no', parcelLayer: 'none', note: 'No current openly licensed statewide parcel layer. The 2017 statewide extract is stale and does not grant a reuse license.' },
  { st: 'KS', name: 'Kansas', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'KY', name: 'Kentucky', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'LA', name: 'Louisiana', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'ME', name: 'Maine', parcels: 'partial', parcelLayer: 'live', note: 'Organized towns that submitted parcels.' },
  { st: 'MD', name: 'Maryland', parcels: 'yes', parcelLayer: 'live' },
  { st: 'MA', name: 'Massachusetts', parcels: 'yes', parcelLayer: 'live' },
  { st: 'MI', name: 'Michigan', parcels: 'no', parcelLayer: 'none', note: 'No statewide public parcel layer.' },
  { st: 'MN', name: 'Minnesota', parcels: 'partial', parcelLayer: 'live', note: 'Participating counties only. Metadata states no access constraints and does not name an open license, so the geometry was not copied.' },
  { st: 'MS', name: 'Mississippi', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'MO', name: 'Missouri', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'MT', name: 'Montana', parcels: 'yes', parcelLayer: 'live' },
  { st: 'NE', name: 'Nebraska', parcels: 'yes', parcelLayer: 'live', note: 'Statewide parcels are already queried live. OCIO terms allow general use and leave authority with the counties; they are not an open redistribution license, so the polygons were not copied.' },
  { st: 'NV', name: 'Nevada', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'NH', name: 'New Hampshire', parcels: 'no', parcelLayer: 'none', note: 'GRANIT publishes a mosaic, but no open redistribution license was identified.' },
  { st: 'NJ', name: 'New Jersey', parcels: 'yes', parcelLayer: 'live' },
  { st: 'NM', name: 'New Mexico', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'NY', name: 'New York', parcels: 'yes', parcelLayer: 'live' },
  { st: 'NC', name: 'North Carolina', parcels: 'yes', parcelLayer: 'live' },
  { st: 'ND', name: 'North Dakota', parcels: 'yes', parcelLayer: 'live' },
  { st: 'OH', name: 'Ohio', parcels: 'yes', parcelLayer: 'live' },
  { st: 'OK', name: 'Oklahoma', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'OR', name: 'Oregon', parcels: 'partial', parcelLayer: 'live', note: 'Participating counties only.' },
  { st: 'PA', name: 'Pennsylvania', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'RI', name: 'Rhode Island', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'SC', name: 'South Carolina', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'SD', name: 'South Dakota', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
  { st: 'TN', name: 'Tennessee', parcels: 'yes', parcelLayer: 'live' },
  { st: 'TX', name: 'Texas', parcels: 'no', parcelLayer: 'none', note: 'The TNRIS StratMap parcel service requires a token and was not copied.' },
  { st: 'UT', name: 'Utah', parcels: 'yes', parcelLayer: 'live' },
  { st: 'VT', name: 'Vermont', parcels: 'yes', parcelLayer: 'live' },
  { st: 'VA', name: 'Virginia', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer added.' },
  { st: 'WA', name: 'Washington', parcels: 'yes', parcelLayer: 'live' },
  { st: 'WV', name: 'West Virginia', parcels: 'yes', parcelLayer: 'live' },
  { st: 'WI', name: 'Wisconsin', parcels: 'yes', parcelLayer: 'live' },
  { st: 'WY', name: 'Wyoming', parcels: 'no', parcelLayer: 'none', note: 'No openly licensed statewide parcel layer.' },
];

const BY_STATE = new Map(STATE_LAND.map(state => [state.st, state]));
export const stateLandRecord = (st: string): StateLandRecord | undefined => BY_STATE.get(st);
export const parcelLabel = (value: string): string => value === 'yes' ? 'Yes' : value === 'partial' ? 'Partial' : value === 'no' ? 'No' : '';

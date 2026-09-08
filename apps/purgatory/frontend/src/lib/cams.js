/**
 * The camera registry — one source of truth.
 *
 * Replaces the CAMS array that was declared independently in five files and
 * the private location table inside CamMap. Every field here is copied from
 * apps/purgatory/scripts/cam_config_seed.json; `place` is the human part of
 * that file's own `notes` field, not invented.
 *
 * Order is corridor order: resort first, descending milepost, which is also
 * ascending distance from the resort. That ordering IS the spatial encoding —
 * there is no map, because ten stations on a one-dimensional road are not
 * two-dimensional data.
 */
export const CAMS = [
  { id: '952-N',  place: 'Purgatory Blvd',        mp: 48.6,  km: 1,  min: 2,  dir: 'N', view: 'inbound',  segment: 'resort' },
  { id: '952-S',  place: 'Purgatory Blvd',        mp: 48.6,  km: 1,  min: 2,  dir: 'S', view: 'outbound', segment: 'resort' },
  { id: '957-N',  place: 'Animas View Dr',        mp: 25.65, km: 37, min: 23, dir: 'N', view: 'inbound',  segment: 'approach' },
  { id: '957-S',  place: 'Animas View Dr',        mp: 25.65, km: 37, min: 23, dir: 'S', view: 'outbound', segment: 'approach' },
  { id: '3285-N', place: 'Hospital St',           mp: 24.15, km: 39, min: 35, dir: 'N', view: 'inbound',  segment: 'town' },
  { id: '3287-N', place: 'W 24th St',             mp: 22.6,  km: 42, min: 37, dir: 'N', view: 'inbound',  segment: 'town' },
  { id: '3288-N', place: 'Alamo Dr',              mp: 22.4,  km: 42, min: 37, dir: 'N', view: 'inbound',  segment: 'town' },
  { id: '3289-S', place: 'W 17th St / E Park',    mp: 22.05, km: 43, min: 38, dir: 'S', view: 'outbound', segment: 'town' },
  { id: '3291-E', place: 'US-550B & 9th St',      mp: 21.3,  km: 44, min: 40, dir: 'E', view: 'junction', segment: 'town' },
  { id: '1053-N', place: 'S of US-160',           mp: 16.25, km: 52, min: 33, dir: 'N', view: 'inbound',  segment: 'south' },
]

export const CAM_IDS = CAMS.map(c => c.id)
export const byId = Object.fromEntries(CAMS.map(c => [c.id, c]))

/** The RWIS station. No image — sensors only. */
export const RWIS = {
  id: '954-RWIS', place: 'RWIS station 374', mp: 20.95, km: 44, station: '374',
}

/**
 * The unmonitored gap. Between the resort pair at MP 48.6 and the next camera
 * at MP 25.65 there is nothing — 23 miles and 21 minutes of driving that this
 * system cannot see. Naming it is more honest than letting ten evenly spaced
 * rows imply even coverage.
 */
export const VOID = {
  afterId: '952-S',
  miles: +(48.6 - 25.65).toFixed(2),
  km: 37 - 1,
  minutes: 23 - 2,
}

/** Camera segment labels — the corridor is not one population. */
export const SEGMENTS = {
  resort:   { label: 'At the resort',       note: '1 km · mountain highway' },
  approach: { label: 'Animas Valley',       note: '37 km · valley approach' },
  town:     { label: 'Durango',            note: '39–44 km · town streets' },
  south:    { label: 'South of Durango',   note: '52 km · rural' },
}

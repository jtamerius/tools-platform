// 34 hail-belt metros: id → { name, lat, lon, latMin, latMax, lonMin, lonMax }
// Center lat/lon derived from bounding box midpoints.
export const METROS = {
  // ── Core Hail Alley ────────────────────────────────────────────────────────
  dfw:              { name: 'Dallas–Fort Worth, TX',    lat: 33.00, lon: -97.10, latMin: 32.40, latMax: 33.60, lonMin: -97.90, lonMax: -96.30 },
  houston:          { name: 'Houston, TX',              lat: 29.80, lon: -95.35, latMin: 29.30, latMax: 30.30, lonMin: -95.90, lonMax: -94.80 },
  san_antonio:      { name: 'San Antonio, TX',          lat: 29.48, lon: -98.40, latMin: 29.10, latMax: 29.85, lonMin: -98.80, lonMax: -98.00 },
  austin:           { name: 'Austin, TX',               lat: 30.28, lon: -97.63, latMin: 29.90, latMax: 30.65, lonMin: -97.95, lonMax: -97.30 },
  lubbock:          { name: 'Lubbock, TX',              lat: 33.60, lon: -101.85, latMin: 33.40, latMax: 33.80, lonMin: -102.10, lonMax: -101.60 },
  amarillo:         { name: 'Amarillo, TX',             lat: 35.15, lon: -101.85, latMin: 34.90, latMax: 35.40, lonMin: -102.20, lonMax: -101.50 },
  okc:              { name: 'Oklahoma City, OK',        lat: 35.50, lon: -97.40, latMin: 35.20, latMax: 35.80, lonMin: -97.80, lonMax: -97.00 },
  tulsa:            { name: 'Tulsa, OK',                lat: 36.15, lon: -95.90, latMin: 35.90, latMax: 36.40, lonMin: -96.20, lonMax: -95.60 },
  wichita:          { name: 'Wichita, KS',              lat: 37.75, lon: -97.35, latMin: 37.50, latMax: 38.00, lonMin: -97.60, lonMax: -97.10 },
  kc:               { name: 'Kansas City, MO/KS',       lat: 39.05, lon: -94.55, latMin: 38.70, latMax: 39.40, lonMin: -94.90, lonMax: -94.20 },
  omaha:            { name: 'Omaha, NE/IA',             lat: 41.33, lon: -96.00, latMin: 41.10, latMax: 41.55, lonMin: -96.30, lonMax: -95.70 },
  lincoln:          { name: 'Lincoln, NE',              lat: 40.83, lon: -96.70, latMin: 40.70, latMax: 40.95, lonMin: -96.90, lonMax: -96.50 },
  denver:           { name: 'Denver, CO',               lat: 39.75, lon: -104.90, latMin: 39.40, latMax: 40.10, lonMin: -105.30, lonMax: -104.50 },
  colorado_springs: { name: 'Colorado Springs, CO',     lat: 38.80, lon: -104.70, latMin: 38.60, latMax: 39.00, lonMin: -104.90, lonMax: -104.50 },
  sioux_falls:      { name: 'Sioux Falls, SD',          lat: 43.53, lon: -96.80, latMin: 43.40, latMax: 43.65, lonMin: -97.00, lonMax: -96.60 },
  fargo:            { name: 'Fargo, ND/MN',             lat: 46.85, lon: -96.85, latMin: 46.70, latMax: 47.00, lonMin: -97.10, lonMax: -96.60 },
  minneapolis:      { name: 'Minneapolis–St. Paul, MN', lat: 44.90, lon: -93.20, latMin: 44.70, latMax: 45.10, lonMin: -93.60, lonMax: -92.80 },
  // ── Midwest ────────────────────────────────────────────────────────────────
  st_louis:         { name: 'St. Louis, MO/IL',         lat: 38.63, lon: -90.28, latMin: 38.40, latMax: 38.85, lonMin: -90.55, lonMax: -90.00 },
  des_moines:       { name: 'Des Moines, IA',            lat: 41.60, lon: -93.60, latMin: 41.40, latMax: 41.80, lonMin: -93.80, lonMax: -93.40 },
  chicago:          { name: 'Chicago, IL',               lat: 41.85, lon: -87.80, latMin: 41.60, latMax: 42.10, lonMin: -88.20, lonMax: -87.40 },
  indianapolis:     { name: 'Indianapolis, IN',          lat: 39.83, lon: -86.15, latMin: 39.60, latMax: 40.05, lonMin: -86.40, lonMax: -85.90 },
  columbus:         { name: 'Columbus, OH',              lat: 40.00, lon: -83.00, latMin: 39.80, latMax: 40.20, lonMin: -83.30, lonMax: -82.70 },
  cincinnati:       { name: 'Cincinnati, OH/KY',         lat: 39.13, lon: -84.50, latMin: 38.95, latMax: 39.30, lonMin: -84.80, lonMax: -84.20 },
  cleveland:        { name: 'Cleveland, OH',             lat: 41.50, lon: -81.70, latMin: 41.30, latMax: 41.70, lonMin: -81.90, lonMax: -81.50 },
  dayton:           { name: 'Dayton, OH',                lat: 39.75, lon: -84.10, latMin: 39.60, latMax: 39.90, lonMin: -84.30, lonMax: -83.90 },
  louisville:       { name: 'Louisville, KY/IN',         lat: 38.18, lon: -85.68, latMin: 37.95, latMax: 38.40, lonMin: -85.95, lonMax: -85.40 },
  nashville:        { name: 'Nashville, TN',             lat: 36.15, lon: -86.80, latMin: 35.90, latMax: 36.40, lonMin: -87.10, lonMax: -86.50 },
  memphis:          { name: 'Memphis, TN/AR/MS',         lat: 35.15, lon: -90.00, latMin: 34.95, latMax: 35.35, lonMin: -90.30, lonMax: -89.70 },
  little_rock:      { name: 'Little Rock, AR',           lat: 34.70, lon: -92.35, latMin: 34.50, latMax: 34.90, lonMin: -92.60, lonMax: -92.10 },
  shreveport:       { name: 'Shreveport, LA/TX',         lat: 32.48, lon: -93.85, latMin: 32.30, latMax: 32.65, lonMin: -94.10, lonMax: -93.60 },
  new_orleans:      { name: 'New Orleans, LA',           lat: 30.00, lon: -90.00, latMin: 29.80, latMax: 30.20, lonMin: -90.40, lonMax: -89.60 },
  baton_rouge:      { name: 'Baton Rouge, LA',           lat: 30.48, lon: -91.10, latMin: 30.30, latMax: 30.65, lonMin: -91.30, lonMax: -90.90 },
  jackson_ms:       { name: 'Jackson, MS',               lat: 32.30, lon: -90.13, latMin: 32.10, latMax: 32.50, lonMin: -90.35, lonMax: -89.90 },
  birmingham:       { name: 'Birmingham, AL',            lat: 33.50, lon: -86.75, latMin: 33.30, latMax: 33.70, lonMin: -87.00, lonMax: -86.50 },
};

export const METRO_LIST = Object.entries(METROS).map(([id, m]) => ({ id, ...m }));

// Backfill window constants
export const BACKFILL_START = '2026-02-02';
export const BACKFILL_END   = '2026-05-01';

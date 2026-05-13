const BASE = import.meta.env.VITE_API_URL ?? '';

// In-memory cache keyed by request signature
const cache = new Map();

function cached(key, fetcher) {
  if (cache.has(key)) return cache.get(key);
  const p = fetcher();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

export function fetchEvents(metro, start, end) {
  return cached(`events|${metro}|${start}|${end}`, async () => {
    const res = await fetch(`${BASE}/api/events?metro=${metro}&start=${start}&end=${end}`);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error);
    }
    const { events } = await res.json();
    return events;
  });
}

export function fetchConusEvents(start, end) {
  return cached(`conus|${start}|${end}`, async () => {
    const res = await fetch(`${BASE}/api/conus?start=${start}&end=${end}`);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error);
    }
    const { events } = await res.json();
    return events;
  });
}

export function fetchStateSummary(start, end) {
  return cached(`state|${start}|${end}`, async () => {
    const res = await fetch(`${BASE}/api/conus/state-summary?start=${start}&end=${end}`);
    if (!res.ok) return [];
    const { rows } = await res.json();
    return rows ?? [];
  });
}

// Singleton — facilities JSON is static and fetched once per session.
// Retries up to 3 times with 2s backoff on failure.
let facilitiesCache = null;
export function fetchFacilities() {
  if (!facilitiesCache) {
    facilitiesCache = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
        try {
          const res = await fetch(`${BASE}/api/facilities`);
          if (!res.ok) throw new Error(res.statusText);
          const { facilities } = await res.json();
          return facilities ?? [];
        } catch (e) {
          if (attempt === 2) return [];
        }
      }
    })();
    facilitiesCache.catch(() => { facilitiesCache = null; });
  }
  return facilitiesCache;
}

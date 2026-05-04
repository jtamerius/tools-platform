const BASE = import.meta.env.VITE_API_URL ?? '';

// In-memory cache: `${metro}|${start}|${end}` → Promise<data>
const cache = new Map();

export async function fetchEvents(metro, start, end) {
  const key = `${metro}|${start}|${end}`;
  if (cache.has(key)) return cache.get(key);

  const promise = (async () => {
    const url = `${BASE}/api/events?metro=${metro}&start=${start}&end=${end}`;
    const res = await fetch(url);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error);
    }
    const { events } = await res.json();
    return events;
  })();

  cache.set(key, promise);
  // Remove failed entries so they can be retried
  promise.catch(() => cache.delete(key));
  return promise;
}

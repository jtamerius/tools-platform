import { useState, useEffect } from 'react';
import { fetchEvents } from '../services/api';
import { METRO_LIST, BACKFILL_START, BACKFILL_END } from '../config/metros';

let cachedResult = null;
let fetchPromise = null;

function loadSummary() {
  if (cachedResult) return Promise.resolve(cachedResult);
  if (fetchPromise) return fetchPromise;

  fetchPromise = Promise.allSettled(
    METRO_LIST.map(m =>
      fetchEvents(m.id, BACKFILL_START, BACKFILL_END).then(events => {
        const total = events.reduce((sum, e) => sum + (Number(e.solar_systems_exposed) || 0), 0);
        return { id: m.id, totalSolarExposed: total };
      }),
    ),
  ).then(results => {
    const totals = new Map();
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totals.set(r.value.id, r.value.totalSolarExposed);
      }
    }
    const sorted = METRO_LIST
      .map(m => ({ ...m, totalSolarExposed: totals.get(m.id) ?? 0 }))
      .sort((a, b) => b.totalSolarExposed - a.totalSolarExposed);
    cachedResult = sorted;
    return sorted;
  });

  return fetchPromise;
}

export function useMetroSummary() {
  const [sortedMetros, setSortedMetros] = useState(METRO_LIST);

  useEffect(() => {
    if (cachedResult) {
      setSortedMetros(cachedResult);
      return;
    }
    loadSummary().then(sorted => setSortedMetros(sorted)).catch(() => {});
  }, []);

  return { sortedMetros };
}

import { useState, useEffect } from 'react';
import { METRO_LIST } from '../config/metros';

const BASE = import.meta.env.VITE_API_URL ?? '';

let cachedResult = null;
let fetchPromise = null;

function loadSummary() {
  if (cachedResult) return Promise.resolve(cachedResult);
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetch(`${BASE}/api/summary`)
    .then(r => r.json())
    .then(data => {
      const totals = data.totals ?? {};
      const sorted = METRO_LIST
        .map(m => ({ ...m, totalSolarExposed: totals[m.id] ?? 0 }))
        .sort((a, b) => b.totalSolarExposed - a.totalSolarExposed);
      cachedResult = sorted;
      return sorted;
    });

  fetchPromise.catch(() => { fetchPromise = null; });
  return fetchPromise;
}

export function useMetroSummary() {
  const [sortedMetros, setSortedMetros] = useState(METRO_LIST);
  const [isResolved, setIsResolved] = useState(false);

  useEffect(() => {
    if (cachedResult) {
      setSortedMetros(cachedResult);
      setIsResolved(true);
      return;
    }
    loadSummary()
      .then(sorted => { setSortedMetros(sorted); setIsResolved(true); })
      .catch(() => setIsResolved(true));
  }, []);

  return { sortedMetros, isResolved };
}

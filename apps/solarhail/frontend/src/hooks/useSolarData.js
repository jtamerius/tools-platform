import { useState, useEffect } from 'react';

const cache = new Map();

export function useSolarData(metroId) {
  const [solarCells, setSolarCells] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!metroId) return;

    if (cache.has(metroId)) {
      setSolarCells(cache.get(metroId));
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`/api/solar?metro=${encodeURIComponent(metroId)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const cells = data.cells ?? [];
        cache.set(metroId, cells);
        setSolarCells(cells);
      })
      .catch(() => {
        if (!cancelled) setSolarCells([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [metroId]);

  return { solarCells, loading };
}

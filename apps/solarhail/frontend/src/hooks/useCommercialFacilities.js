import { useState, useEffect } from 'react';
import { fetchFacilities } from '../services/api';

/**
 * Loads USPVDB facility list once and returns a Map from h3_index → facility[].
 * Returns null until loaded so callers can show a placeholder.
 */
export function useCommercialFacilities() {
  const [facilitiesByH3, setFacilitiesByH3] = useState(null);

  useEffect(() => {
    fetchFacilities().then(list => {
      const map = new Map();
      for (const f of list) {
        if (!map.has(f.h3_index)) map.set(f.h3_index, []);
        map.get(f.h3_index).push(f);
      }
      setFacilitiesByH3(map);
    });
  }, []);

  return { facilitiesByH3 };
}

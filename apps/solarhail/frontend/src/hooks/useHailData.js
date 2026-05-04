import { useState, useEffect, useMemo } from 'react';
import { fetchEvents } from '../services/api';
import { BACKFILL_START, BACKFILL_END } from '../config/metros';

/**
 * Fetches all hail events for a metro (full backfill range), then filters
 * client-side by the selected date window. Aggregates per H3 cell.
 *
 * Returns:
 *   { cells, stats, loading, error }
 *
 * cells: [{ h3_index, maxMeshMm, totalSolarExposed, hailDays }]
 * stats: { hailDays, maxMeshMm, totalSolarExposed, cellsAffected }
 */
export function useHailData(metro, startDate, endDate) {
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  // Re-fetch when metro changes; always fetch full backfill range so date
  // slider filtering is purely client-side (instant response).
  useEffect(() => {
    if (!metro) return;
    setLoading(true);
    setError(null);
    setAllEvents([]);

    fetchEvents(metro, BACKFILL_START, BACKFILL_END)
      .then(events => setAllEvents(events))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [metro]);

  // Filter by date window, then aggregate per H3 cell.
  const { cells, stats } = useMemo(() => {
    const filtered = allEvents.filter(
      e => e.event_date >= startDate && e.event_date <= endDate,
    );

    // Per-cell aggregation
    const cellMap = new Map();
    for (const ev of filtered) {
      const existing = cellMap.get(ev.h3_index);
      const solar = Number(ev.solar_systems_exposed) || 0;
      if (!existing) {
        cellMap.set(ev.h3_index, {
          h3_index: ev.h3_index,
          maxMeshMm: ev.max_mesh_mm,
          totalSolarExposed: solar,
          hailDays: new Set([ev.event_date]),
        });
      } else {
        existing.maxMeshMm = Math.max(existing.maxMeshMm, ev.max_mesh_mm);
        existing.totalSolarExposed = Math.max(existing.totalSolarExposed, solar);
        existing.hailDays.add(ev.event_date);
      }
    }

    const cells = Array.from(cellMap.values()).map(c => ({
      ...c,
      hailDays: c.hailDays.size,
    }));

    const distinctDates = new Set(filtered.map(e => e.event_date));
    const stats = {
      hailDays:          distinctDates.size,
      maxMeshMm:         cells.length ? Math.max(...cells.map(c => c.maxMeshMm)) : 0,
      totalSolarExposed: cells.reduce((s, c) => s + c.totalSolarExposed, 0),
      cellsAffected:     cells.length,
    };

    return { cells, stats };
  }, [allEvents, startDate, endDate]);

  return { cells, stats, loading, error };
}

import { useState, useEffect, useMemo } from 'react';
import { cellToLatLng } from 'h3-js';
import { fetchConusEvents } from '../services/api';
import { BACKFILL_START } from '../config/metros';

function getMonthlyChunks() {
  const chunks = [];
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday — today's pipeline may not have run yet
  let cur = new Date(BACKFILL_START);

  while (cur <= end) {
    const chunkStart = cur.toISOString().slice(0, 10);
    const lastDay = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const chunkEnd = (lastDay < end ? lastDay : end).toISOString().slice(0, 10);
    chunks.push([chunkStart, chunkEnd]);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return chunks;
}

/**
 * Fetches all CONUS hail events in monthly chunks (to stay under API Gateway
 * 10MB response limit). Returns cells with lat/lng for viewport filtering.
 *
 * cells: [{ h3_index, maxMeshMm, totalSolarExposed, totalCommercialMwdc, hailDays, lat, lng }]
 */
export function useHailData(startDate, endDate) {
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const chunks = getMonthlyChunks();
    let mounted = true;
    let arrived = 0;
    const total = chunks.length;

    chunks.forEach(([s, e]) => {
      fetchConusEvents(s, e)
        .then(events => {
          if (!mounted) return;
          arrived++;
          if (arrived === 1) setLoading(false); // show data after first chunk
          setAllEvents(prev => [...prev, ...events]);
        })
        .catch(err => {
          if (!mounted) return;
          arrived++;
          if (arrived === total) {
            setLoading(false);
            setError(err.message);
          }
        });
    });

    return () => { mounted = false; };
  }, []); // fetch once; cache prevents repeat calls on re-render

  const cells = useMemo(() => {
    const filtered = allEvents.filter(
      e => e.event_date >= startDate && e.event_date <= endDate,
    );

    const cellMap = new Map();
    for (const ev of filtered) {
      const solar = Number(ev.solar_systems_exposed) || 0;
      const commercial = Number(ev.commercial_capacity_mwdc) || 0;
      const existing = cellMap.get(ev.h3_index);
      if (!existing) {
        const [lat, lng] = cellToLatLng(ev.h3_index);
        cellMap.set(ev.h3_index, {
          h3_index: ev.h3_index,
          maxMeshMm: ev.max_mesh_mm,
          totalSolarExposed: solar,
          totalCommercialMwdc: commercial,
          hailDays: new Set([ev.event_date]),
          lat,
          lng,
        });
      } else {
        existing.maxMeshMm = Math.max(existing.maxMeshMm, ev.max_mesh_mm);
        existing.totalSolarExposed = Math.max(existing.totalSolarExposed, solar);
        existing.totalCommercialMwdc = Math.max(existing.totalCommercialMwdc, commercial);
        existing.hailDays.add(ev.event_date);
      }
    }

    return Array.from(cellMap.values()).map(c => ({ ...c, hailDays: c.hailDays.size }));
  }, [allEvents, startDate, endDate]);

  return { cells, loading, error };
}

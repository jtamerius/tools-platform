import { useState, useEffect, useMemo } from 'react';
import { cellToLatLng } from 'h3-js';
import { fetchConusEvents } from '../services/api';
import { BACKFILL_START } from '../config/metros';

function getWeeklyChunks() {
  const chunks = [];
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday — today's pipeline may not have run yet
  let cur = new Date(BACKFILL_START);

  while (cur <= end) {
    const chunkStart = cur.toISOString().slice(0, 10);
    const chunkEndDate = new Date(cur);
    chunkEndDate.setDate(chunkEndDate.getDate() + 6);
    const chunkEnd = (chunkEndDate < end ? chunkEndDate : end).toISOString().slice(0, 10);
    chunks.push([chunkStart, chunkEnd]);
    cur = new Date(chunkEndDate);
    cur.setDate(cur.getDate() + 1);
  }
  return chunks;
}

/**
 * Fetches all CONUS hail events in weekly chunks (to stay under API Gateway
 * response limit — monthly chunks exceed 6MB with full unfiltered data). Returns cells with lat/lng for viewport filtering.
 *
 * cells: [{ h3_index, maxMeshMm, totalSolarExposed, totalCommercialMwdc, hailDays, lat, lng }]
 */
export function useHailData(startDate, endDate) {
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allLoaded, setAllLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setAllLoaded(false);
    setError(null);

    const chunks = getWeeklyChunks();
    let mounted = true;
    let arrived = 0;
    const total = chunks.length;

    function fetchChunk(s, e, retries = 2) {
      return fetchConusEvents(s, e).catch(err => {
        if (!mounted || retries <= 0) throw err;
        return new Promise(r => setTimeout(r, 2000)).then(() => fetchChunk(s, e, retries - 1));
      });
    }

    chunks.forEach(([s, e]) => {
      fetchChunk(s, e)
        .then(events => {
          if (!mounted) return;
          arrived++;
          if (arrived === 1) setLoading(false);
          if (arrived === total) setAllLoaded(true);
          setAllEvents(prev => [...prev, ...events]);
        })
        .catch(err => {
          if (!mounted) return;
          arrived++;
          console.error(`[chunk ${s}–${e} FAILED after retries]`, err.message);
          if (arrived === total) {
            setLoading(false);
            setAllLoaded(true);
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

  return { cells, loading, allLoaded, error };
}

import { CAM_IDS } from './cams'
import { band, cohortRank, mtHour, occupancyRate } from './stats'

/** Insert nulls for missing 15-minute ticks so charts break instead of lying. */
function withGaps(records, stepMs = 15 * 60 * 1000) {
  const asc = [...records].sort((a, b) => (a.sk < b.sk ? -1 : 1))
  const out = []
  for (let i = 0; i < asc.length; i++) {
    if (i > 0) {
      const gap = new Date(asc[i].sk) - new Date(asc[i - 1].sk)
      if (gap > stepMs * 1.5) out.push({ sk: null, v: null })
    }
    out.push({ sk: asc[i].sk, v: asc[i].vehicle_count ?? null })
  }
  return out
}

/**
 * Build the rail's row model from 168 h of raw records plus the day-scale
 * cells that carry the long baseline.
 */
export function buildRows(histories, healthByCam) {
  const rows = {}
  const now = Date.now()

  for (const id of CAM_IDS) {
    const recs = (histories?.[id] ?? []).filter(r => r.vehicle_count != null)
    if (!recs.length) { rows[id] = { health: healthByCam?.[id]?.state ?? 'dark' }; continue }

    const desc = [...recs].sort((a, b) => (a.sk < b.sk ? -1 : 1))
    const latest = desc[desc.length - 1]
    const last24 = desc.filter(r => now - new Date(r.sk).getTime() <= 24 * 3600 * 1000)
    const counts24 = last24.map(r => r.vehicle_count)

    // Cohort: the same hour of day across the whole 7-day window, excluding
    // the current hour's own observations.
    const hour = mtHour(latest.sk)
    const cohort = desc
      .filter(r => mtHour(r.sk) === hour && now - new Date(r.sk).getTime() > 3600 * 1000)
      .map(r => r.vehicle_count)
    const b = band(cohort)

    const h = healthByCam?.[id]
    const ageMs = now - new Date(latest.sk).getTime()
    const state = h?.state === 'view' ? 'view' : ageMs > 40 * 60 * 1000 ? 'lag' : 'ok'

    rows[id] = {
      latestSk: latest.sk,
      lastAt: latest.sk,
      count: latest.vehicle_count,
      spark: withGaps(last24),
      bandTop: b?.p75 ?? null,
      pct: cohortRank(latest.vehicle_count, cohort),
      n: cohort.length,
      occupancy: occupancyRate(counts24),
      health: state,
      healthDetail: h?.detail,
    }
  }
  return rows
}

/** Corridor summary — median of per-camera occupancy, never a sum. */
export function corridorSummary(rows) {
  const occ = CAM_IDS.map(id => rows?.[id]?.occupancy).filter(v => v != null).sort((a, b) => a - b)
  const reporting = CAM_IDS.filter(id => rows?.[id]?.latestSk).length
  const degraded = CAM_IDS.filter(id => rows?.[id]?.health === 'view')
  const median = occ.length
    ? (occ.length % 2 ? occ[occ.length >> 1] : (occ[(occ.length >> 1) - 1] + occ[occ.length >> 1]) / 2)
    : null
  const newest = CAM_IDS
    .map(id => rows?.[id]?.lastAt).filter(Boolean).sort().pop()
  return { medianOccupancy: median, reporting, total: CAM_IDS.length, degraded, newest }
}

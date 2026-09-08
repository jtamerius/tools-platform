import { useEffect, useMemo, useState } from 'react'
import Masthead from '../components/Masthead'
import CameraRail from '../components/rail/CameraRail'
import LiveFrame from '../components/LiveFrame'
import { CAM_IDS, byId } from '../lib/cams'
import { buildRows, corridorSummary } from '../lib/series'
import { detectHealth } from '../lib/health'
import { composeHeadline } from '../lib/headline'

const SERIES_START = '2026-05-20'   // the v5 detector boundary
const DEFAULT_CAM = '3289-S'        // busiest daytime view — the frame with cars in it

const daysSince = d =>
  Math.floor((Date.now() - new Date(`${d}T00:00:00Z`).getTime()) / 86400000)

export default function CorridorPage({ api }) {
  const [histories, setHistories] = useState({})
  const [dayCells, setDayCells] = useState({})
  const [zones, setZones] = useState([])
  const [selected, setSelected] = useState(DEFAULT_CAM)
  const [selectedSk, setSelectedSk] = useState(null)
  const [error, setError] = useState(null)

  // Recent detail for the rail: 7 days of raw records, ten cameras.
  useEffect(() => {
    let cancelled = false
    api.fetchMultiHistory(168)
      .then(h => { if (!cancelled) setHistories(h) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [api])

  // The long baseline for health detection: pre-aggregated day cells.
  useEffect(() => {
    let cancelled = false
    api.fetchSeriesChunked({
      scale: 'day', start: SERIES_START,
      end: new Date().toISOString().slice(0, 10), cams: CAM_IDS, chunkDays: 60,
    })
      .then(r => { if (!cancelled) setDayCells(r.by_cam ?? {}) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [api])

  useEffect(() => {
    let cancelled = false
    if (!selected) return
    api.fetchCamConfig(selected)
      .then(c => { if (!cancelled) setZones(c?.zones ?? []) })
      .catch(() => { if (!cancelled) setZones([]) })
    return () => { cancelled = true }
  }, [api, selected])

  const health = useMemo(() => detectHealth(dayCells), [dayCells])
  const rows = useMemo(() => buildRows(histories, health), [histories, health])
  const summary = useMemo(() => corridorSummary(rows), [rows])
  const daysOfRecord = daysSince(SERIES_START)
  const frames = useMemo(
    () => Object.values(dayCells).reduce((s, cells) => s + cells.reduce((t, c) => t + (c.n ?? 0), 0), 0),
    [dayCells]
  )
  const headline = useMemo(
    () => composeHeadline({ summary, rows, daysOfRecord }),
    [summary, rows, daysOfRecord]
  )

  const activeSk = selectedSk ?? rows[selected]?.latestSk ?? null
  const activeRecord = (histories[selected] ?? []).find(r => r.sk === activeSk)

  const onSelect = (camId, sk) => { setSelected(camId); setSelectedSk(sk ?? null) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Masthead headline={headline} summary={summary} daysOfRecord={daysOfRecord} frames={frames} />

      {error && (
        <p style={{ color: 'var(--dev-far-hi)', fontSize: 13 }}>Could not load recent frames: {error}</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 560px) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
        <CameraRail rows={rows} api={api} selected={selected} onSelect={onSelect} />
        <LiveFrame
          api={api}
          camId={selected}
          sk={activeSk}
          count={activeRecord?.vehicle_count ?? rows[selected]?.count}
          zones={zones}
          record={activeRecord}
        />
      </div>

      <footer style={{ borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
        <p className="micro" style={{ lineHeight: 1.6, maxWidth: '90ch' }}>
          Counts are instantaneous in-frame occupancy from a YOLOv8 detector, never a flow rate — so
          they are averaged, never summed, and cameras are combined by median rather than total.
          Cameras {summary.degraded.map(id => byId[id]?.place ?? id).join(', ') || 'none currently'}
          {summary.degraded.length ? ' are excluded from the corridor reading.' : '.'}
          {' '}Median occupancy across {summary.reporting} reporting cameras:{' '}
          {summary.medianOccupancy == null ? '—' : `${Math.round(summary.medianOccupancy * 100)}% of frames contain a vehicle`}.
        </p>
      </footer>
    </div>
  )
}

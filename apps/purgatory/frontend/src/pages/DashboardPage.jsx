import { useEffect, useMemo, useState } from 'react'
import MultiCamPlot from '../components/MultiCamPlot'
import AggregatePlot from '../components/AggregatePlot'
import CamMap from '../components/CamMap'
import SnapshotPanel from '../components/SnapshotPanel'

const HOUR_OPTIONS = [1, 6, 24, 48, 168]
const hourLabel = h => h === 168 ? '1w' : `${h}h`

const CAMS = ['952-N', '952-S', '957-N', '957-S', '1053-N', '3285-N', '3287-N', '3288-N', '3289-S', '3291-E']

const STAT_WINDOWS = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hr',   minutes: 60 },
  { label: '3 hr',   minutes: 180 },
  { label: '24 hr',  minutes: 1440 },
]

// Get MT hour from a UTC ISO string
const mtHour = sk =>
  parseInt(new Date(sk).toLocaleString('sv', { timeZone: 'America/Denver' }).slice(11, 13), 10)

const ordinal = n => {
  if (n == null) return null
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const pctLabel = p => {
  if (p == null) return null
  if (p >= 75) return 'High'
  if (p >= 50) return 'Mod. high'
  if (p >= 25) return 'Moderate'
  return 'Low'
}

const pctColor = p =>
  p == null ? 'var(--text-muted)'
  : p >= 75 ? 'var(--red)'
  : p >= 50 ? 'var(--amber)'
  : p >= 25 ? 'var(--green)'
  : 'var(--accent)'

const s = {
  page: { display: 'flex', flexDirection: 'column', gap: 16 },
  controls: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  label: { fontSize: 12, color: 'var(--text-muted)' },
  hourBtn: (active) => ({
    padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'var(--surface)',
    color: active ? '#000' : 'var(--text)',
    fontSize: 13, fontWeight: active ? 600 : 400,
  }),
  plusBtn: {
    padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text)', fontSize: 13,
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 },
  cardTitle: { fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 },
  statItem: { textAlign: 'center', padding: '8px 4px' },
  rwisGrid: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  rwisItem: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', minWidth: 120 },
  rwisKey: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 },
  rwisVal: { fontSize: 16, fontWeight: 600, color: 'var(--text)' },
  camRow: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  camChip: (enabled) => ({
    display: 'inline-flex', alignItems: 'center',
    padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
    border: `1px solid ${enabled ? 'var(--accent)' : 'var(--border)'}`,
    background: enabled ? 'rgba(96,165,250,0.12)' : 'var(--surface-2)',
    color: enabled ? 'var(--accent)' : 'var(--text-muted)',
  }),
  empty: { padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 },
}

function fmt(v, unit = '') {
  if (v == null) return '—'
  const n = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v)
  return unit ? `${n} ${unit}` : n
}

export default function DashboardPage({ api }) {
  const [hours, setHours] = useState(24)
  const [histories, setHistories] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [enabledCams, setEnabledCams] = useState(
    Object.fromEntries(CAMS.map(id => [id, true]))
  )
  const [selectedCam, setSelectedCam] = useState(null)
  const [selectedSk, setSelectedSk] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.fetchMultiHistory(hours).then(h => {
      if (cancelled) return
      setHistories(h)
    }).catch(e => {
      if (cancelled) return
      setError(e.message)
    }).finally(() => {
      if (cancelled) return
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [hours, api])

  // When a camera is clicked on the map: select it and jump to its latest record
  const handleCamClick = (camId) => {
    const recs = (histories[camId] ?? []).filter(r => r.s3_key)
    setSelectedCam(camId)
    setSelectedSk(recs.length > 0 ? recs[0].sk : null)
  }

  // When a chart point is clicked: navigate to that timestamp
  const handlePointClick = (sk) => {
    const cam = selectedCam || '952-N'
    if (!selectedCam) setSelectedCam('952-N')
    // Find nearest available sk in that cam's history
    const recs = (histories[cam] ?? []).filter(r => r.s3_key)
    if (!recs.length) { setSelectedSk(sk); return }
    // Pick the record whose sk is closest to the clicked sk
    const target = new Date(sk).getTime()
    const nearest = recs.reduce((best, r) => {
      const diff = Math.abs(new Date(r.sk).getTime() - target)
      return diff < Math.abs(new Date(best.sk).getTime() - target) ? r : best
    })
    setSelectedSk(nearest.sk)
  }

  // Per-cam percentile for the most recent 15-min window vs same hour of day
  const camPercentiles = useMemo(() => {
    const now = new Date()
    const cutoff15 = new Date(now.getTime() - 15 * 60 * 1000)
    const nowHour = mtHour(now.toISOString())
    const result = {}

    CAMS.forEach(camId => {
      const recs = (histories[camId] ?? []).slice().sort((a, b) => a.sk < b.sk ? -1 : 1)
      if (!recs.length) return

      // Prefix sums over sorted records
      const prefix = [0]
      recs.forEach(r => prefix.push(prefix[prefix.length - 1] + (r.vehicle_count ?? 0)))

      // Current 15-min count
      const recent = recs.filter(r => new Date(r.sk) >= cutoff15)
      const currentCount = recent.reduce((s, r) => s + (r.vehicle_count ?? 0), 0)

      // Same-hour windows of 15-min in historical data
      const intervals = 1
      const sameHourTotals = []
      for (let i = intervals; i <= recs.length; i++) {
        const endSk = recs[i - 1].sk
        if (mtHour(endSk) === nowHour) {
          sameHourTotals.push(prefix[i] - prefix[i - intervals])
        }
      }

      if (sameHourTotals.length >= 2) {
        const below = sameHourTotals.filter(t => t <= currentCount).length
        result[camId] = Math.round(below / sameHourTotals.length * 100)
      }
    })
    return result
  }, [histories])

  // Aggregate traffic stats across enabled cams, compared against same hour of day
  const trafficStats = useMemo(() => {
    const now = new Date()
    const nowHour = mtHour(now.toISOString())

    const byTs = {}
    Object.entries(enabledCams).forEach(([camId, enabled]) => {
      if (!enabled) return
      ;(histories[camId] ?? []).forEach(r => {
        byTs[r.sk] = (byTs[r.sk] ?? 0) + (r.vehicle_count ?? 0)
      })
    })
    const sorted = Object.entries(byTs).sort(([a], [b]) => a < b ? -1 : 1)
    if (!sorted.length) return null

    const prefix = [0]
    sorted.forEach(([, v]) => prefix.push(prefix[prefix.length - 1] + v))

    return STAT_WINDOWS.map(({ label, minutes }) => {
      const cutoff = new Date(now.getTime() - minutes * 60 * 1000)
      const recent = sorted.filter(([sk]) => new Date(sk) >= cutoff)
      const count = recent.reduce((s, [, v]) => s + v, 0)

      // Compare against same-hour windows of the same duration
      const intervals = Math.max(1, Math.round(minutes / 15))
      const sameHourTotals = []
      for (let i = intervals; i <= sorted.length; i++) {
        const endSk = sorted[i - 1][0]
        if (mtHour(endSk) === nowHour) {
          sameHourTotals.push(prefix[i] - prefix[i - intervals])
        }
      }

      let pct = null
      if (sameHourTotals.length >= 2) {
        const below = sameHourTotals.filter(t => t <= count).length
        pct = Math.round(below / sameHourTotals.length * 100)
      }

      return { label, count, pct, n: sameHourTotals.length }
    })
  }, [histories, enabledCams])

  const latest952 = (histories['952-N'] ?? [])[0]
  const rwisFields = [
    { key: 'Visibility', val: fmt(latest952?.rwis_visibility_mi, 'mi') },
    { key: 'Pavement',   val: fmt(latest952?.rwis_pavement_status) },
    { key: 'Air temp',   val: fmt(latest952?.rwis_temp_air_f, '°F') },
    { key: 'Precip',     val: fmt(latest952?.rwis_precip_situation) },
    { key: 'Wind avg',   val: fmt(latest952?.rwis_wind_avg_mph, 'mph') },
    { key: 'Wind max',   val: fmt(latest952?.rwis_wind_max_mph, 'mph') },
  ]

  const hasData = Object.values(histories).some(r => r.length > 0)
  const isPreset = HOUR_OPTIONS.includes(hours)
  const toggleCam = id => setEnabledCams(prev => ({ ...prev, [id]: !prev[id] }))

  return (
    <div style={s.page}>

      {/* Time controls */}
      <div style={s.controls}>
        <span style={s.label}>Show last</span>
        {HOUR_OPTIONS.map(h => (
          <button key={h} style={s.hourBtn(h === hours)} onClick={() => setHours(h)}>
            {hourLabel(h)}
          </button>
        ))}
        <button style={s.plusBtn} onClick={() => setHours(h => h + 12)}>+12h</button>
        {!isPreset && <span style={s.label}>({hours}h)</span>}
        {loading && <span style={{ ...s.label, marginLeft: 8 }}>Loading…</span>}
        {error && <span style={{ color: 'var(--red)', fontSize: 13 }}>Error: {error}</span>}
      </div>

      {/* Map + Snapshot */}
      <div style={s.grid2}>
        <div style={s.card}>
          <div style={s.cardTitle}>
            Camera locations
            {Object.keys(camPercentiles).length > 0 && (
              <span style={{ marginLeft: 8, fontWeight: 400 }}>
                — marker color = current traffic vs same hour
              </span>
            )}
          </div>
          <CamMap onCamClick={handleCamClick} camPercentiles={camPercentiles} />
        </div>
        <SnapshotPanel
          camId={selectedCam}
          sk={selectedSk}
          records={selectedCam ? (histories[selectedCam] ?? []) : []}
          api={api}
          onClose={() => { setSelectedCam(null); setSelectedSk(null) }}
          onNavigate={setSelectedSk}
        />
      </div>

      {/* Traffic stats */}
      {trafficStats && (
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
            <div style={s.cardTitle}>Traffic summary — selected cameras</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              vs same hour of day · {hours}h window
            </div>
          </div>
          <div style={s.statGrid}>
            {trafficStats.map(({ label, count, pct, n }) => (
              <div key={label} style={s.statItem}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: 12, marginTop: 5, color: pctColor(pct), fontWeight: 600 }}>
                  {pct != null ? pctLabel(pct) : '—'}
                </div>
                <div style={{ fontSize: 10, marginTop: 2, color: 'var(--text-faint)' }}>
                  {pct != null ? `${ordinal(pct)} %ile` : n < 2 ? 'need more data' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aggregated plot — clicking a point shows snapshot */}
      <div style={s.card}>
        <div style={s.cardTitle}>Aggregated vehicle count — click any point to view snapshot</div>
        <div style={s.camRow}>
          {CAMS.map(id => (
            <div key={id} style={s.camChip(enabledCams[id])} onClick={() => toggleCam(id)}>
              {id}
            </div>
          ))}
        </div>
        <AggregatePlot
          histories={histories}
          hours={hours}
          enabledCams={enabledCams}
          onPointClick={handlePointClick}
        />
      </div>

      {/* Per-camera plot */}
      <div style={s.card}>
        <div style={s.cardTitle}>Vehicle counts — per camera</div>
        {hasData
          ? <MultiCamPlot histories={histories} hours={hours} />
          : <div style={s.empty}>{loading ? 'Loading…' : 'No data for this period.'}</div>}
      </div>

      {/* RWIS strip */}
      <div>
        <div style={{ ...s.label, marginBottom: 8 }}>
          Current conditions — RWIS station 374
          {latest952 && (
            <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>
              ({new Date(latest952.sk).toLocaleString('en-US', {
                timeZone: 'America/Denver', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
              })})
            </span>
          )}
        </div>
        <div style={s.rwisGrid}>
          {rwisFields.map(({ key, val }) => (
            <div key={key} style={s.rwisItem}>
              <div style={s.rwisKey}>{key}</div>
              <div style={s.rwisVal}>{val}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import MultiCamPlot from '../components/MultiCamPlot'
import AggregatePlot from '../components/AggregatePlot'
import CamMap from '../components/CamMap'

const HOUR_OPTIONS = [1, 3, 6, 24, 48, 168]
const hourLabel = h => h === 168 ? '1w' : `${h}h`

const CAMS = ['952-N', '952-S', '957-N', '957-S', '1053-N', '3285-N', '3287-N', '3288-N', '3289-S', '3291-E']

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
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 },
  cardTitle: { fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' },
  rwisGrid: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  rwisItem: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', minWidth: 120 },
  rwisKey: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 },
  rwisVal: { fontSize: 16, fontWeight: 600, color: 'var(--text)' },
  empty: { padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 },
  camRow: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  camChip: (enabled) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
    border: `1px solid ${enabled ? 'var(--accent)' : 'var(--border)'}`,
    background: enabled ? 'rgba(96,165,250,0.12)' : 'var(--surface-2)',
    color: enabled ? 'var(--accent)' : 'var(--text-muted)',
  }),
  dirBtn: (active) => ({
    padding: '2px 6px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
    border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#000' : 'var(--text-muted)',
  }),
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
  const [camSel, setCamSel] = useState(() =>
    Object.fromEntries(CAMS.map(id => [id, { enabled: id === '952-N' || id === '952-S', dir: 'both' }]))
  )

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

  const camsWithZones = useMemo(() => {
    const s = new Set()
    Object.entries(histories).forEach(([id, recs]) => {
      if (recs.some(r => r.vehicle_counts_by_zone && Object.keys(r.vehicle_counts_by_zone).length > 0))
        s.add(id)
    })
    return s
  }, [histories])

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

  const toggleCam = id => setCamSel(prev => ({ ...prev, [id]: { ...prev[id], enabled: !prev[id].enabled } }))
  const setDir = (id, dir) => setCamSel(prev => ({ ...prev, [id]: { ...prev[id], dir } }))

  return (
    <div style={s.page}>

      {/* Shared time controls */}
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

      {/* Per-camera plot + map */}
      <div style={s.grid}>
        <div style={s.card}>
          <div style={s.cardTitle}>Vehicle counts — US-550 corridor</div>
          {hasData
            ? <MultiCamPlot histories={histories} hours={hours} />
            : <div style={s.empty}>{loading ? 'Loading…' : 'No data for this period.'}</div>}
        </div>
        <div style={s.card}>
          <div style={s.cardTitle}>Camera locations</div>
          <CamMap />
        </div>
      </div>

      {/* Aggregated plot */}
      <div style={s.card}>
        <div style={s.cardTitle}>Aggregated vehicle count</div>
        <div style={s.camRow}>
          {CAMS.map(id => {
            const sel = camSel[id]
            const hasZones = camsWithZones.has(id)
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={s.camChip(sel.enabled)} onClick={() => toggleCam(id)}>
                  {id}
                </div>
                {sel.enabled && hasZones && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button style={s.dirBtn(sel.dir === 'Inbound')}  onClick={() => setDir(id, 'Inbound')}>Inbound</button>
                    <button style={s.dirBtn(sel.dir === 'both')}     onClick={() => setDir(id, 'both')}>Both</button>
                    <button style={s.dirBtn(sel.dir === 'Outbound')} onClick={() => setDir(id, 'Outbound')}>Outbound</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <AggregatePlot histories={histories} hours={hours} camSel={camSel} camsWithZones={camsWithZones} />
      </div>

      {/* RWIS strip */}
      <div>
        <div style={{ ...s.label, marginBottom: 8 }}>
          Current conditions — RWIS station 374
          {latest952 && <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>({new Date(latest952.sk).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })})</span>}
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

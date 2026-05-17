// Dashboard: multi-cam plot + camera map + RWIS strip
import { useEffect, useState } from 'react'
import MultiCamPlot from '../components/MultiCamPlot'
import CamMap from '../components/CamMap'

const HOUR_OPTIONS = [1, 3, 6, 12, 24, 48]

const s = {
  page: { display: 'flex', flexDirection: 'column', gap: 16 },
  controls: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { fontSize: 12, color: 'var(--text-muted)' },
  hourBtn: (active) => ({
    padding: '4px 12px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'var(--surface)',
    color: active ? '#000' : 'var(--text)',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
  }),
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 },
  cardTitle: { fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' },
  rwisGrid: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  rwisItem: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', minWidth: 120 },
  rwisKey: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 },
  rwisVal: { fontSize: 16, fontWeight: 600 },
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

  // Pull RWIS fields from the most recent 952-N record
  const latest952 = (histories['952-N'] ?? [])[0]
  const rwisFields = [
    { key: 'Visibility',  val: fmt(latest952?.rwis_visibility_mi, 'mi') },
    { key: 'Pavement',    val: fmt(latest952?.rwis_pavement_status) },
    { key: 'Air temp',    val: fmt(latest952?.rwis_temp_air_f, '°F') },
    { key: 'Precip',      val: fmt(latest952?.rwis_precip_situation) },
    { key: 'Wind avg',    val: fmt(latest952?.rwis_wind_avg_mph, 'mph') },
    { key: 'Wind max',    val: fmt(latest952?.rwis_wind_max_mph, 'mph') },
  ]

  const hasData = Object.values(histories).some(r => r.length > 0)

  return (
    <div style={s.page}>
      <div style={s.controls}>
        <span style={s.label}>Show last</span>
        {HOUR_OPTIONS.map(h => (
          <button key={h} style={s.hourBtn(h === hours)} onClick={() => setHours(h)}>
            {h}h
          </button>
        ))}
        {loading && <span style={{ ...s.label, marginLeft: 8 }}>Loading…</span>}
        {error && <span style={{ color: 'var(--red)', fontSize: 13 }}>Error: {error}</span>}
      </div>

      <div style={s.grid}>
        <div style={s.card}>
          <div style={s.cardTitle}>Vehicle counts — US-550 corridor</div>
          {hasData
            ? <MultiCamPlot histories={histories} hours={hours} />
            : <div style={s.empty}>{loading ? 'Loading…' : 'No data for this period.'}</div>
          }
        </div>
        <div style={s.card}>
          <div style={s.cardTitle}>Camera locations</div>
          <CamMap />
        </div>
      </div>

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

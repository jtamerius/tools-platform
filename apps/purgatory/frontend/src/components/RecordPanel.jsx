import { useEffect, useState } from 'react'
import TrafficPlot from './TrafficPlot'

const s = {
  panel: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, color: 'var(--text)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: 600 },
  meta: { color: 'var(--text-muted)', fontSize: 13 },
  image: { width: '100%', borderRadius: 6, background: 'var(--bg)', minHeight: 240, objectFit: 'contain' },
  row: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: 'var(--text)' },
  key: { color: 'var(--text-muted)' },
  agent: { marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 6, fontSize: 13 },
  confidence: (c) => ({
    color: c == null ? 'var(--text-muted)' : c > 0.85 ? 'var(--green)' : c > 0.6 ? 'var(--amber)' : 'var(--red)',
    fontWeight: 600,
  }),
  buttons: { display: 'flex', gap: 8, marginTop: 16 },
  btn: (variant) => ({
    flex: 1, padding: '10px 14px', borderRadius: 6, border: 'none', fontWeight: 600, fontSize: 14,
    background: variant === 'keep' ? 'var(--green)' : variant === 'unusable' ? 'var(--red)' : 'var(--amber)',
    color: '#000',
  }),
  nav: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-muted)' },
}

function fmt(v) {
  if (v == null) return '—'
  if (typeof v === 'number') return v.toString().includes('.') ? v.toFixed(2) : String(v)
  return String(v)
}

export default function RecordPanel({ record, api, onDecide, onNext, onPrev, index, total }) {
  const [imageUrl, setImageUrl] = useState(null)
  const [neighbors, setNeighbors] = useState([])
  const [history, setHistory] = useState([])

  useEffect(() => {
    setImageUrl(null)
    setNeighbors([])
    setHistory([])
    api.fetchImage(record.pk, record.sk).then(setImageUrl).catch(() => setImageUrl(null))
    api.fetchNeighbors(record.sk).then(setNeighbors).catch(() => setNeighbors([]))
    api.fetchHistory(record.cam_id, 24).then(setHistory).catch(() => setHistory([]))
  }, [record.pk, record.sk, record.cam_id, api])

  const rwis = [
    ['Pavement', record.rwis_pavement_status],
    ['Visibility', record.rwis_visibility_mi != null ? `${fmt(record.rwis_visibility_mi)} mi` : null],
    ['Air temp', record.rwis_temp_air_f != null ? `${fmt(record.rwis_temp_air_f)}°F` : null],
    ['Precip', record.rwis_precip_situation],
    ['Wind avg', record.rwis_wind_avg_mph != null ? `${fmt(record.rwis_wind_avg_mph)} mph` : null],
  ]

  const sunIsNight = record.solar_altitude_deg != null && record.solar_altitude_deg < 0
  const sunIsTwilight = !sunIsNight && record.solar_altitude_deg != null && record.solar_altitude_deg < 10

  return (
    <div style={s.panel}>
      <div style={s.card}>
        <div style={s.header}>
          <div>
            <div style={s.title}>{record.cam_id}</div>
            <div style={s.meta}>{record.sk}</div>
          </div>
          <div style={s.nav}>
            <button onClick={onPrev} disabled={index === 0}>‹</button>
            <span>{index + 1} / {total}</span>
            <button onClick={onNext} disabled={index === total - 1}>›</button>
          </div>
        </div>

        {imageUrl
          ? <img src={imageUrl} alt={record.cam_id} style={s.image} />
          : <div style={{ ...s.image, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Loading image…</div>}

        <div style={s.buttons}>
          <button style={s.btn('keep')} onClick={() => onDecide('keep')}>Keep</button>
          <button style={s.btn('unusable')} onClick={() => onDecide('unusable')}>Unusable</button>
          <button style={s.btn('follow')} onClick={() => onDecide('needs_follow_up')}>Follow up</button>
        </div>
      </div>

      <div>
        <div style={s.card}>
          <div style={s.row}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Total vehicles</span>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>
              {record.vehicle_counts_by_zone
                ? Object.values(record.vehicle_counts_by_zone).reduce((a, b) => Number(a) + Number(b), 0)
                : fmt(record.vehicle_count)}
            </span>
          </div>
          {record.vehicle_counts_by_zone
            ? Object.entries(record.vehicle_counts_by_zone).map(([zone, n]) => (
                <div key={zone} style={{ ...s.row, paddingLeft: 12 }}>
                  <span style={s.key}>{zone}</span>
                  <span style={{ color: 'var(--text)' }}>{fmt(n)}</span>
                </div>
              ))
            : null
          }
          {record.traffic_score_sample_n != null && record.traffic_score_sample_n < 30 && (
            <div style={{ ...s.meta, marginBottom: 4 }}>insufficient history (n={record.traffic_score_sample_n})</div>
          )}

          <div style={{ marginTop: 12 }}>
            {rwis.map(([k, v]) => (
              <div key={k} style={s.row}>
                <span style={s.key}>{k}</span><span>{fmt(v)}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8 }}>
            <div style={s.row}>
              <span style={s.key}>Solar altitude</span>
              <span>{record.solar_altitude_deg != null ? `${fmt(record.solar_altitude_deg)}° ${sunIsNight ? '(night)' : sunIsTwilight ? '(twilight)' : ''}` : '—'}</span>
            </div>
            <div style={s.row}>
              <span style={s.key}>Image edge density</span><span>{fmt(record.img_edge_density)}</span>
            </div>
            <div style={s.row}>
              <span style={s.key}>YOLO confidence</span><span>{fmt(record.yolo_confidence_mean)}</span>
            </div>
          </div>

          {record.agent_decision && (
            <div style={s.agent}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>Agent: {record.agent_decision}</strong>
                <span style={s.confidence(record.agent_confidence)}>
                  {fmt(record.agent_confidence)}
                </span>
              </div>
              <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>{record.agent_reasoning}</div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>
                source: {record.agent_decision_source} · prompt: {record.agent_prompt_version}
              </div>
            </div>
          )}
        </div>

        <div style={{ ...s.card, marginTop: 12 }}>
          <strong>Neighboring cams @ {record.sk}</strong>
          <div style={{ marginTop: 8 }}>
            {neighbors.length === 0
              ? <div style={s.meta}>No simultaneous readings</div>
              : neighbors.map(n => (
                  <div key={n.pk} style={s.row}>
                    <span style={s.key}>{n.cam_id}</span><span>{fmt(n.vehicle_count)}</span>
                  </div>
                ))}
          </div>
        </div>

        <div style={{ ...s.card, marginTop: 12 }}>
          <strong>Last 24 hours — {record.cam_id}</strong>
          <TrafficPlot history={history} highlightSk={record.sk} />
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'

const s = {
  panel: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  camName: { fontSize: 15, fontWeight: 700, color: 'var(--text)' },
  ts: { fontSize: 12, color: 'var(--text-muted)', marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 2px', marginLeft: 8,
  },
  imgBox: {
    width: '100%', borderRadius: 6, background: 'var(--bg)',
    minHeight: 200, objectFit: 'contain',
  },
  placeholder: {
    width: '100%', minHeight: 200, borderRadius: 6, background: 'var(--bg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-muted)', fontSize: 13,
  },
  counts: { display: 'flex', gap: 20, alignItems: 'baseline' },
  countVal: { fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1 },
  countLabel: { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 },
  nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  navBtn: (disabled) => ({
    padding: '5px 14px', borderRadius: 4, border: '1px solid var(--border)',
    background: 'var(--surface-2)',
    color: disabled ? 'var(--text-faint)' : 'var(--text)',
    fontSize: 12, cursor: disabled ? 'default' : 'pointer',
  }),
  navPos: { fontSize: 12, color: 'var(--text-muted)' },
  empty: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 300, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center',
    flexDirection: 'column', gap: 6,
  },
}

function fmt(v) {
  if (v == null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1)
  return String(v)
}

export default function SnapshotPanel({ camId, sk, records, api, onClose, onNavigate }) {
  const [imageUrl, setImageUrl] = useState(null)
  const [loading, setLoading] = useState(false)

  // Only navigate records that have images
  const withImages = records.filter(r => r.s3_key)
  const idx = withImages.findIndex(r => r.sk === sk)
  const record = idx >= 0 ? withImages[idx] : null

  useEffect(() => {
    if (!camId || !sk) return
    setLoading(true)
    setImageUrl(null)
    api.fetchImage(`CAM#${camId}`, sk)
      .then(url => setImageUrl(url))
      .catch(() => setImageUrl(null))
      .finally(() => setLoading(false))
  }, [camId, sk, api])

  if (!camId) {
    return (
      <div style={{ ...s.panel, ...s.empty }}>
        <div style={{ fontSize: 32, opacity: 0.3 }}>&#9654;</div>
        <div>Click a camera on the map</div>
        <div style={{ fontSize: 11 }}>or a data point on the chart</div>
      </div>
    )
  }

  const tsDisplay = sk
    ? new Date(sk).toLocaleString('en-US', {
        timeZone: 'America/Denver',
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      })
    : '—'

  const canNewer = idx > 0
  const canOlder = idx >= 0 && idx < withImages.length - 1

  const totalVehicles = record?.vehicle_counts_by_zone
    ? Object.values(record.vehicle_counts_by_zone).reduce((a, b) => Number(a) + Number(b), 0)
    : record?.vehicle_count

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <div>
          <div style={s.camName}>{camId}</div>
          <div style={s.ts}>{tsDisplay}</div>
        </div>
        <button style={s.closeBtn} onClick={onClose} title="Close">&#x2715;</button>
      </div>

      {loading
        ? <div style={s.placeholder}>Loading…</div>
        : imageUrl
          ? <img src={imageUrl} alt={camId} style={s.imgBox} />
          : <div style={s.placeholder}>{sk ? 'No image for this record' : 'No record selected'}</div>
      }

      {record && (
        <div style={s.counts}>
          <div>
            <div style={s.countVal}>{fmt(totalVehicles)}</div>
            <div style={s.countLabel}>total vehicles</div>
          </div>
          {record.vehicle_counts_by_zone && Object.entries(record.vehicle_counts_by_zone).map(([zone, n]) => (
            <div key={zone}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{fmt(Number(n))}</div>
              <div style={s.countLabel}>{zone.toLowerCase()}</div>
            </div>
          ))}
        </div>
      )}

      <div style={s.nav}>
        <button
          style={s.navBtn(!canOlder)}
          disabled={!canOlder}
          onClick={() => canOlder && onNavigate(withImages[idx + 1].sk)}
        >← Older</button>
        <span style={s.navPos}>
          {withImages.length > 0 && idx >= 0 ? `${idx + 1} / ${withImages.length}` : 'no records'}
        </span>
        <button
          style={s.navBtn(!canNewer)}
          disabled={!canNewer}
          onClick={() => canNewer && onNavigate(withImages[idx - 1].sk)}
        >Newer →</button>
      </div>
    </div>
  )
}

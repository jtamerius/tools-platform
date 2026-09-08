import { useEffect, useState } from 'react'
import { byId } from '../lib/cams'
import { ago } from '../lib/stats'
import ZoneOverlay from './ZoneOverlay'

/**
 * The selected camera's most recent frame, large.
 *
 * The zone polygons drawn over it are not decoration: yolo_count only counts a
 * detection whose bottom-centre falls inside one of these polygons, so the
 * outline is the literal derivation of the number printed beside it.
 */
export default function LiveFrame({ api, camId, sk, count, zones, record }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(null)
  const cam = byId[camId]

  useEffect(() => {
    let cancelled = false
    setUrl(null); setErr(null)
    if (!camId || !sk) return
    api.fetchImage(`CAM#${camId}`, sk)
      .then(u => { if (!cancelled) setUrl(u) })
      .catch(e => { if (!cancelled) setErr(e.message) })
    return () => { cancelled = true }
  }, [api, camId, sk])

  const zoneCounts = record?.vehicle_counts_by_zone

  return (
    <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <h2 style={{ marginBottom: 10 }}>What is it looking at right now?</h2>

      <div style={{
        position: 'relative', background: 'var(--ink-700)', borderRadius: 'var(--r-img)',
        overflow: 'hidden', aspectRatio: '4 / 3',
      }}>
        {url && <img src={url} alt={`${cam?.place ?? camId} at ${sk}`}
                     style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        {url && zones?.length > 0 && (
          <ZoneOverlay
            zones={zones}
            counts={zoneCounts}
            width={record?.image_width ?? 320}
            height={record?.image_height ?? 240}
          />
        )}
        {!url && (
          <span className="micro" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            {err ? `no frame — ${err}` : 'loading frame…'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--txt-hi)', fontSize: 14, fontWeight: 500 }}>{cam?.place ?? camId}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--txt-faint)' }}>
          {camId} · MP {cam?.mp} · {cam?.min} min from the resort
        </span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--txt-lo)' }}>
          {sk ? `${ago(sk)} ago` : ''}
        </span>
      </div>

      <p className="micro" style={{ marginTop: 6, fontStyle: 'italic', lineHeight: 1.5 }}>
        {count != null
          ? `${count} vehicle${count === 1 ? '' : 's'} detected in frame`
          : 'no detection on this frame'}
        {zoneCounts
          ? ` — inbound ${zoneCounts.Inbound ?? 0}, outbound ${zoneCounts.Outbound ?? 0}. `
          : '. '}
        A count is what is visible in one instant, not vehicles per hour.
      </p>
    </section>
  )
}

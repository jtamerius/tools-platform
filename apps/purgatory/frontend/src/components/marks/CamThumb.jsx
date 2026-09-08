import { useEffect, useState } from 'react'

/**
 * The latest frame from one camera, 78x44.
 *
 * A thumbnail per rail row is the cheapest possible proof that this is a real
 * system reading a real road. The well is painted even before the presigned
 * URL resolves, so the rail never shifts layout.
 */
export default function CamThumb({ api, camId, sk, width = 78, height = 44, alt }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setUrl(null); setFailed(false)
    if (!sk) return
    api.fetchImage(`CAM#${camId}`, sk)
      .then(u => { if (!cancelled) setUrl(u) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [api, camId, sk])

  return (
    <div style={{
      width, height, borderRadius: 'var(--r-img)', overflow: 'hidden',
      background: 'var(--ink-700)', position: 'relative', flex: 'none',
    }}>
      {url && (
        <img
          src={url} alt={alt || `${camId} latest frame`} width={width} height={height}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setFailed(true)}
        />
      )}
      {(failed || !sk) && (
        <span className="micro" style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          color: 'var(--txt-faint)', fontSize: 9,
        }}>{failed ? 'no frame' : ''}</span>
      )}
    </div>
  )
}

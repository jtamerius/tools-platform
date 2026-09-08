import { useMemo } from 'react'

/**
 * 24-hour occupancy trace for one camera.
 *
 * The stroke is always neutral. Deviation is carried by the FILL between the
 * line and the typical band — which is what keeps ten simultaneous sparklines
 * from becoming a colour riot when they sit stacked in the rail.
 *
 * Missing ticks break the line rather than being dropped, so a gap in the data
 * looks like a gap (the USGS hydrograph convention).
 */
export default function Sparkline({ points, bandTop, width = 108, height = 26, tone = 'var(--dev-typ)' }) {
  const d = useMemo(() => {
    if (!points || points.length < 2) return null
    const vals = points.map(p => p.v).filter(v => v != null)
    if (!vals.length) return null
    const max = Math.max(1, ...vals, bandTop ?? 0)
    const x = i => (i / (points.length - 1)) * width
    const y = v => height - 1 - (v / max) * (height - 3)

    // Break the path on nulls instead of interpolating across them.
    let path = '', open = false
    points.forEach((p, i) => {
      if (p.v == null) { open = false; return }
      path += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`
      open = true
    })
    const area = (() => {
      const seg = points.map((p, i) => (p.v == null ? null : [x(i), y(p.v)])).filter(Boolean)
      if (seg.length < 2) return null
      return `M${seg[0][0].toFixed(1)},${height} `
        + seg.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
        + ` L${seg[seg.length - 1][0].toFixed(1)},${height} Z`
    })()
    return { path, area, bandY: bandTop != null ? y(bandTop) : null }
  }, [points, bandTop, width, height])

  if (!d) {
    return (
      <svg width={width} height={height} role="img" aria-label="no data">
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="var(--rule)" strokeWidth="1" />
      </svg>
    )
  }
  return (
    <svg width={width} height={height} role="img" aria-label="24-hour trace">
      {d.bandY != null && (
        <rect x="0" y={d.bandY} width={width} height={Math.max(0, height - 1 - d.bandY)} fill="var(--band)" />
      )}
      {d.area && <path d={d.area} fill={tone} fillOpacity="0.28" />}
      <path d={d.path} fill="none" stroke="#7e90a8" strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" />
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="var(--rule)" strokeWidth="1" />
    </svg>
  )
}

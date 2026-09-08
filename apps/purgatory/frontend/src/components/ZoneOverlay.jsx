/**
 * The counting zones, drawn over the frame.
 *
 * A detection is counted only when its bounding box's bottom-centre falls
 * inside one of these polygons, so this outline is the literal derivation of
 * the number beside the image — worth showing rather than describing.
 */
const TONE = { Inbound: 'var(--accent)', Outbound: 'var(--dev-hi)' }

/**
 * Polygons are stored in SOURCE PIXEL coordinates (the frames are 320x240),
 * not normalised, so the viewBox has to match the image the zones were drawn
 * against rather than a unit square.
 */
export default function ZoneOverlay({ zones, counts, width = 320, height = 240 }) {
  if (!zones?.length) return null
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
         style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {zones.map(z => {
        const pts = (z.polygon || z.points || [])
          .map(p => (Array.isArray(p) ? `${p[0]},${p[1]}` : `${p.x},${p.y}`))
          .join(' ')
        if (!pts) return null
        const tone = TONE[z.name] ?? 'var(--txt-lo)'
        // Label the polygon with the count derived from it, so the outline and
        // the number are visibly the same fact.
        const n = counts?.[z.name]
        const xs = (z.polygon || z.points || []).map(p => (Array.isArray(p) ? p[0] : p.x))
        const ys = (z.polygon || z.points || []).map(p => (Array.isArray(p) ? p[1] : p.y))
        const cx = xs.reduce((a, b) => a + b, 0) / xs.length
        const cy = ys.reduce((a, b) => a + b, 0) / ys.length
        return (
          <g key={z.name}>
            <polygon points={pts}
                     fill={tone} fillOpacity="0.10"
                     stroke={tone} strokeOpacity="0.8"
                     strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            {n != null && (
              <text x={cx} y={cy} fill={tone} fontSize="13" fontWeight="600"
                    textAnchor="middle" dominantBaseline="middle"
                    style={{ paintOrder: 'stroke', stroke: 'rgba(7,10,15,0.75)', strokeWidth: 3 }}>
                {z.name} {n}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

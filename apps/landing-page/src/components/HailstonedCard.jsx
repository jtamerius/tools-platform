const APP_URL = 'https://hailstoned.jtamerius.com'
const ABOUT_URL = '/#/apps/hailstoned'

const HEX_CELLS = [
  // Row 0
  { x: 136.3,  y: 36,  color: '#ffe500', o: 0.55, delay: '1.2s' },
  { x: 164.0,  y: 36,  color: '#ffd000', o: 0.60, delay: '1.0s' },
  { x: 191.7,  y: 36,  color: '#ffe500', o: 0.55, delay: '1.2s' },
  // Row 1
  { x: 122.45, y: 60,  color: '#ffd000', o: 0.65, delay: '0.9s' },
  { x: 150.15, y: 60,  color: '#ff8800', o: 0.75, delay: '0.6s' },
  { x: 177.85, y: 60,  color: '#ff7700', o: 0.75, delay: '0.7s' },
  { x: 205.55, y: 60,  color: '#ffaa22', o: 0.65, delay: '1.0s' },
  // Row 2 (hot core)
  { x: 108.6,  y: 84,  color: '#ffaa22', o: 0.70, delay: '0.5s' },
  { x: 136.3,  y: 84,  color: '#ff5500', o: 0.85, delay: '0.3s' },
  { x: 164.0,  y: 84,  color: '#cc0000', o: 0.95, delay: '0.0s' },
  { x: 191.7,  y: 84,  color: '#dd2200', o: 0.90, delay: '0.2s' },
  { x: 219.4,  y: 84,  color: '#ff7700', o: 0.75, delay: '0.5s' },
  // Row 3
  { x: 122.45, y: 108, color: '#ffd000', o: 0.65, delay: '0.8s' },
  { x: 150.15, y: 108, color: '#ff7700', o: 0.80, delay: '0.5s' },
  { x: 177.85, y: 108, color: '#ff8800', o: 0.75, delay: '0.6s' },
  { x: 205.55, y: 108, color: '#ffaa22', o: 0.60, delay: '0.9s' },
  // Row 4
  { x: 136.3,  y: 132, color: '#ffe500', o: 0.55, delay: '1.1s' },
  { x: 164.0,  y: 132, color: '#ffd000', o: 0.60, delay: '1.0s' },
  { x: 191.7,  y: 132, color: '#ffe500', o: 0.55, delay: '1.2s' },
  // Fading edges
  { x: 80.9,   y: 84,  color: '#ffe500', o: 0.30, delay: '1.4s' },
  { x: 247.1,  y: 84,  color: '#ffe500', o: 0.30, delay: '1.5s' },
  { x: 94.75,  y: 60,  color: '#ffe500', o: 0.25, delay: '1.6s' },
  { x: 233.25, y: 108, color: '#ffe500', o: 0.25, delay: '1.7s' },
]

export default function HailstonedCard() {
  function handleClick(e) {
    if (e.target.closest('[data-secondary]')) return
    window.open(APP_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="hs-card" onClick={handleClick} style={S.card} role="button" tabIndex={0}
         onKeyDown={e => e.key === 'Enter' && handleClick(e)}>

      {/* Visual header */}
      <div style={S.visual}>
        <svg style={S.hexSvg} viewBox="0 0 360 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <symbol id="hs-hex" viewBox="-10 -10 20 20">
              <polygon points="-8.66,-5 0,-10 8.66,-5 8.66,5 0,10 -8.66,5"
                       fill="currentColor" stroke="#0a0d18" strokeWidth="0.6" />
            </symbol>
          </defs>
          <g>
            {HEX_CELLS.map((cell, i) => (
              <use
                key={i}
                href="#hs-hex"
                className="hs-hex-cell"
                style={{ '--o': String(cell.o), animationDelay: cell.delay }}
                x={cell.x} y={cell.y}
                width="32" height="32"
                color={cell.color}
              />
            ))}
          </g>
        </svg>

        {/* Badge */}
        <div style={S.badge}>
          <div style={{ ...S.pip, background: '#00e87a', boxShadow: '0 0 0 3px rgba(0,232,122,0.18)' }} />
          Hailstoned
        </div>

        {/* Severity strip */}
        <div style={S.strip}>
          <div style={{ ...S.stripBar, background: 'linear-gradient(to right, #ffe500, #ff8800, #cc0000)' }} />
          <div style={S.stripTicks}>
            <span>Moderate</span>
            <span>Significant</span>
            <span>Severe</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={S.body}>
        <div style={S.titleRow}>
          <h3 style={S.title} aria-label="Hailstoned">
            Hail<em style={{ fontStyle: 'normal', color: '#00e87a' }}>stoned</em>
          </h3>
          <a className="hs-arrow" href={APP_URL} target="_blank" rel="noopener noreferrer"
             data-secondary style={S.arrow} onClick={e => e.stopPropagation()} aria-label="Launch Hailstoned">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 9L9 3M9 3H4M9 3V8" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>

        <p style={S.desc}>
          Spatiotemporal analysis distilling 3 months of high-volume radar history into
          hail-risk estimates for solar arrays. Processed on a serverless backend; deployed
          as a static site from S3 to keep costs near zero.
        </p>

        <div style={S.meta}>
          {['Spatiotemporal', 'Geoviz', 'Big data', 'Serverless · S3'].map(t => (
            <span key={t} style={S.tag}>{t}</span>
          ))}
        </div>

        <a href={ABOUT_URL} className="card-about" data-secondary style={S.aboutLink}
           onClick={e => e.stopPropagation()}>
          About this project →
        </a>
      </div>
    </div>
  )
}

const S = {
  card: {
    width: '360px',
    background: '#0e1120',
    border: '1px solid #1e2540',
    borderRadius: '14px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    transition: 'transform .25s ease, border-color .25s ease, box-shadow .25s ease',
    cursor: 'pointer',
    position: 'relative',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: '#e8eaf0',
    WebkitFontSmoothing: 'antialiased',
  },
  visual: {
    position: 'relative',
    height: '200px',
    background: 'radial-gradient(ellipse at 50% 110%, #1a2236 0%, #0a0d18 70%)',
    overflow: 'hidden',
    borderBottom: '1px solid #1e2540',
  },
  hexSvg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    top: '14px',
    left: '14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 9px',
    background: 'rgba(11,13,24,0.7)',
    border: '1px solid #2a3050',
    borderRadius: '999px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#8b93a8',
    backdropFilter: 'blur(6px)',
  },
  pip: {
    width: '6px',
    height: '6px',
    borderRadius: '999px',
  },
  strip: {
    position: 'absolute',
    left: '14px',
    right: '14px',
    bottom: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  stripBar: {
    height: '5px',
    borderRadius: '999px',
    opacity: 0.92,
  },
  stripTicks: {
    display: 'flex',
    justifyContent: 'space-between',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '9px',
    color: '#8b93a8',
    letterSpacing: '0.06em',
  },
  body: {
    padding: '20px 22px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    letterSpacing: '-0.025em',
    margin: 0,
    color: '#e8eaf0',
  },
  arrow: {
    width: '28px',
    height: '28px',
    borderRadius: '999px',
    background: '#12162a',
    border: '1px solid #2a3050',
    color: '#8b93a8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'background .2s, color .2s, border-color .2s, transform .2s',
    textDecoration: 'none',
  },
  desc: {
    color: '#8b93a8',
    fontSize: '13.5px',
    lineHeight: 1.5,
    margin: 0,
  },
  meta: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px',
    flexWrap: 'wrap',
  },
  tag: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#5b6480',
    padding: '4px 8px',
    border: '1px solid #1e2540',
    borderRadius: '4px',
    background: '#12162a',
  },
  aboutLink: {
    fontSize: '11.5px',
    letterSpacing: '0.02em',
    marginTop: '4px',
    textDecoration: 'none',
    transition: 'color 0.15s',
  },
}

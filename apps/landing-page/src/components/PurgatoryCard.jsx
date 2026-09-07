const APP_URL = 'https://purg.jtamerius.com'
const ABOUT_URL = '/#/apps/purgatory'

// Vehicles detected down the corridor — boxes shrink toward the vanishing
// point at (180, 52) so the frame reads as depth rather than a flat grid.
const BOXES = [
  { x: 100, y: 104, w: 64, h: 38, color: '#ff6b2c', o: 0.95, delay: '0.0s', label: 'CAR' },
  { x: 186, y: 88,  w: 44, h: 27, color: '#ff8c1f', o: 0.85, delay: '0.4s', label: 'CAR' },
  { x: 150, y: 74,  w: 32, h: 20, color: '#ffa733', o: 0.72, delay: '0.8s' },
  { x: 166, y: 58,  w: 22, h: 14, color: '#ffc266', o: 0.55, delay: '1.2s' },
]

// Lane dashes along the centerline, narrowing with distance.
const DASHES = [
  { y: 138, w: 15 },
  { y: 118, w: 11 },
  { y: 100, w: 8 },
  { y: 84,  w: 6 },
  { y: 70,  w: 4 },
]

export default function PurgatoryCard() {
  function handleClick(e) {
    if (e.target.closest('[data-secondary]')) return
    window.open(APP_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="pg-card" onClick={handleClick} style={S.card} role="button" tabIndex={0}
         onKeyDown={e => e.key === 'Enter' && handleClick(e)}>

      {/* Visual header */}
      <div style={S.visual}>
        <svg style={S.svg} viewBox="0 0 360 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <linearGradient id="pg-sweep-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#ffa733" stopOpacity="0" />
              <stop offset="100%" stopColor="#ffa733" stopOpacity="0.5" />
            </linearGradient>
          </defs>

          {/* Road cone toward the vanishing point */}
          <path d="M 30,150 L 168,52 L 192,52 L 330,150 Z"
                fill="rgba(255,167,51,0.03)" />
          <line x1="30" y1="150" x2="168" y2="52" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
          <line x1="330" y1="150" x2="192" y2="52" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
          <line x1="0" y1="52" x2="360" y2="52" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

          {/* Centerline dashes */}
          {DASHES.map(d => (
            <rect key={d.y} x={180 - d.w / 2} y={d.y} width={d.w} height={2}
                  fill="rgba(255,255,255,0.14)" rx="1" />
          ))}

          {/* Detection scan sweep */}
          <rect className="pg-sweep" x="0" y="46" width="360" height="10"
                fill="url(#pg-sweep-grad)" />

          {/* Detection boxes */}
          {BOXES.map((b, i) => (
            <g key={i} className="pg-box"
               style={{ '--o': String(b.o), animationDelay: b.delay }}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="2"
                    fill={b.color} fillOpacity="0.10"
                    stroke={b.color} strokeWidth="1.2" />
              {b.label && (
                <text x={b.x + 1} y={b.y - 4}
                      fontFamily="'JetBrains Mono', monospace" fontSize="7"
                      fill={b.color} letterSpacing="0.08em">{b.label}</text>
              )}
            </g>
          ))}

          {/* Corner brackets on the nearest detection */}
          {[
            'M 100,116 L 100,104 L 112,104',
            'M 152,104 L 164,104 L 164,116',
            'M 164,130 L 164,142 L 152,142',
            'M 112,142 L 100,142 L 100,130',
          ].map(d => (
            <path key={d} d={d} stroke="#ff6b2c" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          ))}
        </svg>

        {/* Badge */}
        <div style={S.badge}>
          <div style={{ ...S.pip, background: '#ffa733', boxShadow: '0 0 0 3px rgba(255,167,51,0.18)' }} />
          Purgatory
        </div>

        {/* Live count readout */}
        <div style={S.count}>
          <span style={S.countNum}>14</span>
          <span style={S.countUnit}>veh</span>
        </div>

        {/* Crowding strip */}
        <div style={S.strip}>
          <div style={{ ...S.stripBar, background: 'linear-gradient(to right, #ffd166, #ff8c1f, #d62828)' }} />
          <div style={S.stripTicks}>
            <span>Quiet</span>
            <span>Busy</span>
            <span>Packed</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={S.body}>
        <div style={S.titleRow}>
          <h3 style={S.title} aria-label="Purgatory">
            Purg<em style={{ fontStyle: 'normal', color: '#ffa733' }}>atory</em>
          </h3>
          <a className="pg-arrow" href={APP_URL} target="_blank" rel="noopener noreferrer"
             data-secondary style={S.arrow} onClick={e => e.stopPropagation()} aria-label="Launch Purgatory">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 9L9 3M9 3H4M9 3V8" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>

        <p style={S.desc}>
          Counts vehicles on the approach corridor every 15 minutes with a YOLO detector,
          pairs them with road-weather and resort conditions, and builds the labeled
          history behind a ski-day crowding forecast.
        </p>

        <div style={S.meta}>
          {['Computer vision', 'Time series', 'Serverless', 'Admin only'].map(t => (
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
    background: 'radial-gradient(ellipse at 50% 110%, #2a2016 0%, #0d0a10 70%)',
    overflow: 'hidden',
    borderBottom: '1px solid #1e2540',
  },
  svg: {
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
    background: 'rgba(13,10,16,0.7)',
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
  count: {
    position: 'absolute',
    top: '14px',
    right: '14px',
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: '4px',
    padding: '4px 9px',
    background: 'rgba(13,10,16,0.7)',
    border: '1px solid #2a3050',
    borderRadius: '999px',
    fontFamily: "'JetBrains Mono', monospace",
    backdropFilter: 'blur(6px)',
  },
  countNum: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#ffa733',
    letterSpacing: '0.02em',
  },
  countUnit: {
    fontSize: '9px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#8b93a8',
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

const APP_URL = 'https://weather.jtamerius.com'

// Ensemble spaghetti lines: clustered start, fanning out rightward
const LINES = [
  { d: 'M 30,100 C 100,93 190,50 340,42',   color: '#00d4ff', o: 0.55, delay: '1.4s', w: 1.0 },
  { d: 'M 30,100 C 100,90 190,64 340,68',   color: '#00bbff', o: 0.65, delay: '0.8s', w: 1.1 },
  { d: 'M 30,100 C 100,95 190,78 340,86',   color: '#0099ff', o: 0.72, delay: '0.4s', w: 1.0 },
  { d: 'M 30,100 C 100,100 190,100 340,100', color: '#4477ff', o: 0.88, delay: '0.0s', w: 1.4 },
  { d: 'M 30,100 C 100,105 190,116 340,114', color: '#3366ee', o: 0.72, delay: '0.5s', w: 1.0 },
  { d: 'M 30,100 C 100,110 190,130 340,132', color: '#2255dd', o: 0.65, delay: '0.9s', w: 1.1 },
  { d: 'M 30,100 C 100,116 190,146 340,152', color: '#1144cc', o: 0.58, delay: '1.2s', w: 1.0 },
  { d: 'M 30,100 C 100,122 190,158 340,164', color: '#0033bb', o: 0.45, delay: '1.6s', w: 1.0 },
]

export default function WeatherCard() {
  function handleClick(e) {
    if (e.target.closest('[data-secondary]')) return
    window.open(APP_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="wx-card" onClick={handleClick} style={S.card} role="button" tabIndex={0}
         onKeyDown={e => e.key === 'Enter' && handleClick(e)}>

      {/* Visual header */}
      <div style={S.visual}>
        <svg style={S.svg} viewBox="0 0 360 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {/* Faint horizontal grid */}
          {[42, 68, 100, 132, 158].map(y => (
            <line key={y} x1="0" y1={y} x2="360" y2={y}
                  stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          ))}

          {/* "Now" marker at x=90 */}
          <line x1="90" y1="10" x2="90" y2="190"
                stroke="#00c8ff" strokeWidth="1" strokeDasharray="3 4" opacity="0.3" />
          <text x="93" y="22" fontFamily="'JetBrains Mono', monospace" fontSize="8"
                fill="#00c8ff" opacity="0.5" letterSpacing="0.05em">NOW</text>

          {/* Ensemble lines */}
          {LINES.map((line, i) => (
            <path key={i} className="wx-line"
                  d={line.d}
                  stroke={line.color}
                  strokeWidth={line.w}
                  strokeLinecap="round"
                  fill="none"
                  style={{ '--o': String(line.o), animationDelay: line.delay }} />
          ))}

          {/* Origin dot */}
          <circle cx="30" cy="100" r="3" fill="#4477ff" opacity="0.9" />
          <circle cx="30" cy="100" r="6" fill="none" stroke="#4477ff" strokeWidth="0.8" opacity="0.3" />
        </svg>

        {/* Badge */}
        <div style={S.badge}>
          <div style={{ ...S.pip, background: '#00c8ff', boxShadow: '0 0 0 3px rgba(0,200,255,0.18)' }} />
          Ensemble
        </div>

        {/* Model strip */}
        <div style={S.strip}>
          <div style={{ ...S.stripBar, background: 'linear-gradient(to right, #0044cc, #0099ff, #00e8c8)' }} />
          <div style={S.stripTicks}>
            <span>GFS</span>
            <span>NAM</span>
            <span>HRRR</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={S.body}>
        <div style={S.titleRow}>
          <h3 style={S.title}>
            Ensemble <em style={{ fontStyle: 'normal', color: '#00c8ff' }}>Weather</em>
          </h3>
          <a className="wx-arrow" href={APP_URL} target="_blank" rel="noopener noreferrer"
             data-secondary style={S.arrow} onClick={e => e.stopPropagation()} aria-label="Launch weather app">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 9L9 3M9 3H4M9 3V8" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>

        <p style={S.desc}>
          Multi-model ensemble forecasts for the Southwest US, blending GFS, NAM, and HRRR
          runs into probability-spread plots for temperature, wind, and precipitation.
        </p>

        <div style={S.meta}>
          {['Multi-model', 'Southwest US', 'React · Plotly'].map(t => (
            <span key={t} style={S.tag}>{t}</span>
          ))}
        </div>
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
    background: 'radial-gradient(ellipse at 50% 110%, #0a1830 0%, #050a18 70%)',
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
    background: 'rgba(5,10,24,0.7)',
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
}

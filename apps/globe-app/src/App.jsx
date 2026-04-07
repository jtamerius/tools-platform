import { useState } from 'react'
import Globe from './components/Globe'

// ─── Sample overlay data ───────────────────────────────────────────────────────
const CITIES = [
  { id: 'nyc',     lat:  40.71,  lng:  -74.01, label: 'New York',      color: '#4af',  alwaysVisible: false },
  { id: 'london',  lat:  51.51,  lng:   -0.13, label: 'London',        color: '#f4a',  alwaysVisible: false },
  { id: 'tokyo',   lat:  35.68,  lng:  139.69, label: 'Tokyo',         color: '#af4',  alwaysVisible: false },
  { id: 'sydney',  lat: -33.87,  lng:  151.21, label: 'Sydney',        color: '#fa4',  alwaysVisible: false },
  { id: 'cairo',   lat:  30.04,  lng:   31.24, label: 'Cairo',         color: '#f84',  alwaysVisible: false },
  { id: 'rio',     lat: -22.91,  lng:  -43.17, label: 'Rio de Janeiro',color: '#4fa',  alwaysVisible: false },
  { id: 'mumbai',  lat:  19.08,  lng:   72.88, label: 'Mumbai',        color: '#c4f',  alwaysVisible: false },
  { id: 'moscow',  lat:  55.75,  lng:   37.62, label: 'Moscow',        color: '#f44',  alwaysVisible: false },
  { id: 'beijing', lat:  39.91,  lng:  116.39, label: 'Beijing',       color: '#ff4',  alwaysVisible: false },
  { id: 'sf',      lat:  37.77,  lng: -122.42, label: 'San Francisco', color: '#4ff',  alwaysVisible: false },
]

export default function App() {
  const [activeOverlays, setActiveOverlays] = useState(
    CITIES.map(c => c.id),
  )
  const [panelOpen, setPanelOpen] = useState(true)
  const [showLightning, setShowLightning] = useState(false)

  const visibleOverlays = CITIES.filter(c => activeOverlays.includes(c.id))

  function toggleCity(id) {
    setActiveOverlays(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  }

  return (
    <div style={styles.root}>
      {/* ── Globe fills the entire viewport ── */}
      <div style={styles.globeWrap}>
        <Globe overlays={visibleOverlays} showLightning={showLightning} />
      </div>

      {/* ── Header bar ── */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logo}>
            <span style={styles.logoIcon}>🌍</span>
            <span style={styles.logoText}>Interactive Globe</span>
          </div>
          <div style={styles.headerHints}>
            <span style={styles.hint}>Drag to rotate</span>
            <span style={styles.hintSep}>·</span>
            <span style={styles.hint}>Scroll to zoom</span>
            <span style={styles.hintSep}>·</span>
            <span style={styles.hint}>Hover markers for labels</span>
          </div>
          <button
            style={styles.panelToggle}
            onClick={() => setPanelOpen(o => !o)}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
          >
            {panelOpen ? 'Hide' : 'Overlays'}
          </button>
        </div>
      </header>

      {/* ── Overlay panel ── */}
      {panelOpen && (
        <aside style={styles.panel}>
          <p style={styles.panelTitle}>Data Layers</p>
          <button
            style={{
              ...styles.cityBtn,
              background: showLightning ? 'rgba(255,220,80,0.1)' : 'transparent',
              borderColor: showLightning ? '#ffdc50' : 'rgba(255,255,255,0.1)',
              color: showLightning ? '#ffdc50' : '#888',
              marginBottom: '12px',
            }}
            onClick={() => setShowLightning(v => !v)}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,220,80,0.15)'}
            onMouseLeave={e => e.currentTarget.style.background = showLightning ? 'rgba(255,220,80,0.1)' : 'transparent'}
          >
            <span style={{
              ...styles.cityDot,
              background: showLightning ? '#ffdc50' : '#444',
              boxShadow: showLightning ? '0 0 6px #ffdc50' : 'none',
            }} />
            Lightning Climatology
          </button>

          <p style={styles.panelTitle}>City Markers</p>
          <div style={styles.cityList}>
            {CITIES.map(city => {
              const on = activeOverlays.includes(city.id)
              return (
                <button
                  key={city.id}
                  style={{
                    ...styles.cityBtn,
                    background: on ? 'rgba(255,255,255,0.07)' : 'transparent',
                    borderColor: on ? city.color : 'rgba(255,255,255,0.1)',
                    color: on ? '#e8e8f0' : '#888',
                  }}
                  onClick={() => toggleCity(city.id)}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = on ? 'rgba(255,255,255,0.07)' : 'transparent'}
                >
                  <span
                    style={{
                      ...styles.cityDot,
                      background: on ? city.color : '#444',
                      boxShadow: on ? `0 0 6px ${city.color}` : 'none',
                    }}
                  />
                  {city.label}
                </button>
              )
            })}
          </div>

          <div style={styles.divider} />

          <p style={styles.infoText}>
            Day &amp; night cycle reflects real current time (UTC).
            Lightning layer: NASA LIS/OTD flash rate climatology.
          </p>
        </aside>
      )}
    </div>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  root: {
    position: 'relative',
    width:    '100vw',
    height:   '100vh',
    overflow: 'hidden',
    background: '#000008',
  },
  globeWrap: {
    position: 'absolute',
    inset: 0,
  },

  // Header
  header: {
    position:   'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    pointerEvents: 'none',
  },
  headerInner: {
    display:     'flex',
    alignItems:  'center',
    gap:         '16px',
    padding:     '14px 20px',
    background:  'linear-gradient(to bottom, rgba(0,0,8,0.75) 0%, transparent 100%)',
    pointerEvents: 'auto',
  },
  logo: {
    display:    'flex',
    alignItems: 'center',
    gap:        '8px',
  },
  logoIcon: {
    fontSize: '1.2rem',
    filter:   'drop-shadow(0 0 6px #4af)',
  },
  logoText: {
    fontSize:      '0.95rem',
    fontWeight:    700,
    color:         '#e8e8f4',
    letterSpacing: '-0.02em',
  },
  headerHints: {
    display:    'flex',
    alignItems: 'center',
    gap:        '6px',
    marginLeft: 'auto',
  },
  hint: {
    fontSize:  '0.72rem',
    color:     'rgba(255,255,255,0.45)',
    fontWeight: 400,
  },
  hintSep: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: '0.72rem',
  },
  panelToggle: {
    padding:      '5px 14px',
    borderRadius: '6px',
    background:   'rgba(255,255,255,0.06)',
    border:       '1px solid rgba(255,255,255,0.12)',
    color:        '#c0c0d0',
    fontSize:     '0.78rem',
    fontWeight:   600,
    cursor:       'pointer',
    transition:   'background 0.15s',
    letterSpacing:'0.03em',
    marginLeft:   '8px',
  },

  // Side panel
  panel: {
    position:    'absolute',
    top:         '60px',
    right:       '16px',
    width:       '220px',
    background:  'rgba(8,10,20,0.82)',
    backdropFilter: 'blur(12px)',
    border:      '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    padding:     '16px',
    zIndex:      10,
    boxShadow:   '0 8px 40px rgba(0,0,0,0.6)',
  },
  panelTitle: {
    fontSize:      '0.68rem',
    fontWeight:    700,
    color:         'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom:  '10px',
  },
  cityList: {
    display:       'flex',
    flexDirection: 'column',
    gap:           '4px',
  },
  cityBtn: {
    display:       'flex',
    alignItems:    'center',
    gap:           '8px',
    padding:       '6px 10px',
    borderRadius:  '6px',
    border:        '1px solid',
    cursor:        'pointer',
    fontSize:      '0.8rem',
    fontWeight:    500,
    textAlign:     'left',
    transition:    'background 0.15s, border-color 0.2s',
    fontFamily:    'inherit',
  },
  cityDot: {
    width:        8,
    height:       8,
    borderRadius: '50%',
    flexShrink:   0,
    transition:   'box-shadow 0.2s',
  },
  divider: {
    height:     '1px',
    background: 'rgba(255,255,255,0.08)',
    margin:     '14px 0',
  },
  infoText: {
    fontSize:   '0.7rem',
    color:      'rgba(255,255,255,0.3)',
    lineHeight: 1.6,
  },
}

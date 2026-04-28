import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import DataMeshCanvas from '../components/DataMeshCanvas'

export default function Home() {
  // Swap body background to dark while this page is mounted
  useEffect(() => {
    const prev = document.body.style.background
    document.body.style.background = '#0d0d0d'
    return () => { document.body.style.background = prev }
  }, [])

  return (
    <>
      <DataMeshCanvas />
      <main style={styles.main}>
        {/* Hero */}
        <section style={styles.hero}>
          <p style={styles.eyebrow}>Welcome</p>
          <h1 style={styles.heading}>
            Hi, I'm J. Tamerius.
          </h1>
          <p style={styles.tagline}>
            I build tools, analyze data, and explore ideas at the intersection of technology and the real world.
          </p>
          <div style={styles.ctas}>
            <Link
              to="/about"
              style={styles.ctaSecondary}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              About me
            </Link>
            <Link
              to="/apps"
              style={styles.ctaPrimary}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#1a1a1a' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff' }}
            >
              Browse apps →
            </Link>
          </div>
        </section>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Brief highlights */}
        <section style={styles.highlights}>
          {HIGHLIGHTS.map((item) => (
            <div key={item.label} style={styles.highlight}>
              <span style={styles.highlightLabel}>{item.label}</span>
              <span style={styles.highlightValue}>{item.value}</span>
            </div>
          ))}
        </section>
      </main>
    </>
  )
}

const HIGHLIGHTS = [
  { label: 'Focus', value: 'Data engineering & internal tooling' },
  { label: 'Stack', value: 'AWS · Python · React' },
  { label: 'Location', value: 'Durango, CO' },
]

const styles = {
  main: {
    flex: 1,
    maxWidth: 'var(--max-w)',
    width: '100%',
    margin: '0 auto',
    padding: '80px 24px 80px',
  },
  hero: {
    maxWidth: '640px',
  },
  eyebrow: {
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: '20px',
  },
  heading: {
    fontSize: 'clamp(2.2rem, 5vw, 3.5rem)',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.15,
    color: '#ffffff',
    marginBottom: '24px',
  },
  tagline: {
    fontSize: '1.1rem',
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 1.65,
    marginBottom: '40px',
    maxWidth: '520px',
  },
  ctas: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  ctaPrimary: {
    display: 'inline-block',
    padding: '10px 22px',
    borderRadius: '8px',
    background: '#ffffff',
    color: '#0d0d0d',
    fontSize: '0.9rem',
    fontWeight: 600,
    transition: 'background 0.12s ease',
    letterSpacing: '-0.01em',
  },
  ctaSecondary: {
    display: 'inline-block',
    padding: '10px 22px',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.75)',
    fontSize: '0.9rem',
    fontWeight: 500,
    border: '1px solid rgba(255,255,255,0.18)',
    transition: 'background 0.12s ease',
  },
  divider: {
    height: '1px',
    background: 'rgba(255,255,255,0.1)',
    margin: '64px 0',
  },
  highlights: {
    display: 'flex',
    gap: '48px',
    flexWrap: 'wrap',
  },
  highlight: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  highlightLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)',
  },
  highlightValue: {
    fontSize: '0.9rem',
    color: 'rgba(255,255,255,0.5)',
  },
}

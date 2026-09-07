import { Link, useParams } from 'react-router-dom'
import SubtleVoronoiCanvas from '../components/SubtleVoronoiCanvas'
import BackButton from '../components/BackButton'
import { APP_INFO, appUrl } from '../config/appInfo'

export default function AppInfo() {
  const { id } = useParams()
  const info = APP_INFO[id]

  if (!info) return <NotFound id={id} />

  const url = appUrl(id)
  const accent = info.accent

  return (
    <>
      <SubtleVoronoiCanvas />
      <BackButton />
      <main style={S.main}>
        <div style={S.content}>

          {/* ── Header ─────────────────────────────────────────── */}
          <header style={S.header}>
            <nav style={S.crumbs}>
              <Link to="/apps" style={S.crumbLink}>Apps</Link>
              <span style={S.crumbSep}>/</span>
              <span>{info.name}</span>
            </nav>

            <div style={{ ...S.accentBar, background: accent }} />

            <h1 style={S.heading}>{info.name}</h1>
            <p style={S.tagline}>{info.tagline}</p>

            <div style={S.headerMeta}>
              <span style={{ ...S.accessBadge, color: accent, borderColor: accent }}>
                <span style={{ ...S.pip, background: accent }} />
                {info.access}
              </span>
              <span style={S.host}>{info.host}</span>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...S.launch, background: accent }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                >
                  Launch
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M3 9L9 3M9 3H4M9 3V8" stroke="currentColor" strokeWidth="1.6"
                          strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              )}
            </div>
          </header>

          <div style={S.rule} />

          {/* ── Overview ───────────────────────────────────────── */}
          <section style={S.section}>
            <h2 style={S.sectionHeading}>Overview</h2>
            {info.summary.map((para, i) => (
              <p key={i} style={S.body}>{para}</p>
            ))}
          </section>

          <div style={S.rule} />

          {/* ── Pipeline ───────────────────────────────────────── */}
          <section style={S.section}>
            <h2 style={S.sectionHeading}>How it works</h2>
            <ol style={S.steps}>
              {info.pipeline.map((step, i) => (
                <li key={step.label} style={S.step}>
                  {i < info.pipeline.length - 1 && (
                    <span style={{ ...S.rail, background: accent }} aria-hidden="true" />
                  )}
                  <span style={{ ...S.node, borderColor: accent, color: accent }}>{i + 1}</span>
                  <div style={S.stepText}>
                    <span style={S.stepLabel}>{step.label}</span>
                    <span style={S.stepDetail}>{step.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div style={S.rule} />

          {/* ── Stack ──────────────────────────────────────────── */}
          <section style={S.section}>
            <h2 style={S.sectionHeading}>Built with</h2>
            <div style={S.tags}>
              {info.stack.map((t) => (
                <span key={t} style={S.tag}>{t}</span>
              ))}
            </div>
          </section>

          <div style={S.rule} />

          {/* ── Facts ──────────────────────────────────────────── */}
          <section style={S.section}>
            <h2 style={S.sectionHeading}>Details</h2>
            <div style={S.factGrid}>
              {info.facts.map(({ label, value }) => (
                <div key={label} style={S.fact}>
                  <span style={S.factLabel}>{label}</span>
                  <span style={S.factValue}>{value}</span>
                </div>
              ))}
            </div>
          </section>

          <div style={S.rule} />

          <Link
            to="/apps"
            style={S.footerLink}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            ← All apps
          </Link>
        </div>
      </main>
    </>
  )
}

function NotFound({ id }) {
  return (
    <>
      <SubtleVoronoiCanvas />
      <BackButton />
      <main style={S.main}>
        <div style={S.content}>
          <p style={S.crumbs}>Not found</p>
          <h1 style={S.heading}>No such app</h1>
          <p style={{ ...S.body, marginTop: '12px' }}>
            There is no app registered under <code style={S.code}>{id}</code>.
          </p>
          <Link to="/apps" style={S.footerLink}>← All apps</Link>
        </div>
      </main>
    </>
  )
}

const S = {
  main: {
    flex: 1,
    maxWidth: 'var(--max-w)',
    width: '100%',
    margin: '0 auto',
    padding: '72px 24px 80px',
    position: 'relative',
    zIndex: 1,
  },
  content: {
    maxWidth: '720px',
  },

  header: {
    marginBottom: '8px',
  },
  crumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
    marginBottom: '20px',
  },
  crumbLink: {
    color: 'var(--text-faint)',
    textDecoration: 'none',
    borderBottom: '1px solid transparent',
  },
  crumbSep: {
    opacity: 0.5,
  },
  accentBar: {
    width: '40px',
    height: '3px',
    borderRadius: '99px',
    marginBottom: '18px',
  },
  heading: {
    fontSize: 'clamp(1.8rem, 4vw, 2.6rem)',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.2,
    color: 'var(--text)',
  },
  tagline: {
    fontSize: '1.05rem',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    marginTop: '10px',
    maxWidth: '56ch',
  },
  headerMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
    marginTop: '24px',
  },
  accessBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '4px 10px',
    borderRadius: '99px',
    border: '1px solid',
    background: 'var(--surface)',
  },
  pip: {
    width: '5px',
    height: '5px',
    borderRadius: '99px',
  },
  host: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: '0.75rem',
    color: 'var(--text-faint)',
    letterSpacing: '0.01em',
  },
  launch: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    marginLeft: 'auto',
    padding: '8px 16px',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '0.8rem',
    fontWeight: 600,
    letterSpacing: '0.01em',
    textDecoration: 'none',
    transition: 'opacity 0.15s ease',
  },

  rule: {
    height: '1px',
    background: 'var(--border)',
    margin: '40px 0',
  },
  section: {
    padding: '8px 0',
  },
  sectionHeading: {
    fontSize: '0.8rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
    marginBottom: '20px',
  },
  body: {
    fontSize: '1rem',
    color: 'var(--text-muted)',
    lineHeight: 1.75,
    marginBottom: '16px',
  },

  steps: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  step: {
    position: 'relative',
    display: 'flex',
    gap: '16px',
    paddingBottom: '22px',
  },
  rail: {
    position: 'absolute',
    left: '13px',
    top: '30px',
    bottom: '0',
    width: '1px',
    opacity: 0.28,
  },
  node: {
    position: 'relative',
    zIndex: 1,
    flexShrink: 0,
    width: '27px',
    height: '27px',
    borderRadius: '99px',
    border: '1px solid',
    background: 'var(--surface)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: '0.72rem',
    fontWeight: 600,
  },
  stepText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    paddingTop: '2px',
  },
  stepLabel: {
    fontSize: '0.92rem',
    fontWeight: 600,
    color: 'var(--text)',
    letterSpacing: '-0.01em',
  },
  stepDetail: {
    fontSize: '0.9rem',
    color: 'var(--text-muted)',
    lineHeight: 1.65,
  },

  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  tag: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: '0.68rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '5px 9px',
  },

  factGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '24px',
  },
  fact: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  factLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
  },
  factValue: {
    fontSize: '0.9rem',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  },

  footerLink: {
    display: 'inline-block',
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    textDecoration: 'none',
    transition: 'color 0.12s ease',
  },
  code: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: '0.85em',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '2px 6px',
  },
}

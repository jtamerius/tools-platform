import AppCard from '../components/AppCard'
import { APPS } from '../config/apps'
import SubtleVoronoiCanvas from '../components/SubtleVoronoiCanvas'
import BackButton from '../components/BackButton'

export default function Apps() {
  return (
    <>
    <SubtleVoronoiCanvas />
    <BackButton />
    <main style={styles.main}>
      <div style={styles.header}>
        <p style={styles.eyebrow}>Platform</p>
        <h1 style={styles.heading}>Apps</h1>
        <p style={styles.subheading}>Browse available tools and applications.</p>
      </div>

      <div style={styles.grid}>
        {APPS.map((app) => (
          <AppCard
            key={app.id}
            id={app.id}
            name={app.name}
            description={app.description}
            url={app.url}
            isPublic={app.isPublic}
            requiredGroup={app.requiredGroup}
          />
        ))}
      </div>
    </main>
    </>
  )
}

const styles = {
  main: {
    flex: 1,
    maxWidth: 'var(--max-w)',
    width: '100%',
    margin: '0 auto',
    padding: '72px 24px 80px',
    position: 'relative',
    zIndex: 1,
  },
  header: {
    marginBottom: '48px',
  },
  eyebrow: {
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
    marginBottom: '16px',
  },
  heading: {
    fontSize: 'clamp(1.8rem, 4vw, 2.6rem)',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.2,
    color: 'var(--text)',
    marginBottom: '12px',
  },
  subheading: {
    fontSize: '0.95rem',
    color: 'var(--text-muted)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '20px',
  },
}

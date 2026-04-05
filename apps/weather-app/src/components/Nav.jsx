export default function Nav() {
  return (
    <header style={styles.header}>
      <div style={styles.inner}>
        <span style={styles.logo}>JT</span>
        <span style={styles.title}>Ensemble Weather</span>
      </div>
    </header>
  )
}

const styles = {
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    background: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderBottom: '1px solid var(--border)',
    height: 'var(--nav-height)',
  },
  inner: {
    maxWidth: 'var(--max-w)',
    margin: '0 auto',
    padding: '0 24px',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  logo: {
    fontSize: '0.95rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    color: 'var(--text)',
    userSelect: 'none',
  },
  title: {
    fontSize: '0.875rem',
    color: 'var(--text-muted)',
    fontWeight: 500,
  },
}

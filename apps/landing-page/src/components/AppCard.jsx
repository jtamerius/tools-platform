export default function AppCard({ name, description, url, isPublic, requiredGroup }) {
  const badgeLabel = isPublic ? 'Public' : requiredGroup === 'admin' ? 'Admin Only' : 'Members Only'
  const badge = isPublic
    ? { label: badgeLabel, bg: '#e8f5e9', color: '#2e7d32' }
    : { label: badgeLabel, bg: '#fff8e1', color: '#f57f17' }

  function handleMouseEnter(e) {
    e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.12)'
    e.currentTarget.style.transform = 'translateY(-2px)'
  }

  function handleMouseLeave(e) {
    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'
    e.currentTarget.style.transform = 'translateY(0)'
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={styles.card}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-label={`Open ${name}`}
    >
      <div style={styles.headerRow}>
        <span style={styles.name}>{name}</span>
        <span style={{ ...styles.badge, background: badge.bg, color: badge.color }}>{badge.label}</span>
      </div>
      <p style={styles.desc}>{description}</p>
    </a>
  )
}

const styles = {
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    background: '#ffffff',
    borderRadius: '10px',
    padding: '20px 22px',
    border: '1px solid #e0e0e0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    transition: 'box-shadow 0.15s ease, transform 0.15s ease',
    minHeight: '150px',
    textDecoration: 'none',
    color: 'inherit',
    cursor: 'pointer',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
  },
  name: {
    fontSize: '1.05rem',
    fontWeight: 600,
    color: '#111',
    lineHeight: 1.3,
  },
  badge: {
    flexShrink: 0,
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    padding: '2px 8px',
    borderRadius: '99px',
    whiteSpace: 'nowrap',
  },
  desc: {
    fontSize: '0.9rem',
    color: '#555',
    lineHeight: 1.5,
    flexGrow: 1,
  },
}

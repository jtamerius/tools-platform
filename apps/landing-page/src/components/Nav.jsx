import { Link, useLocation } from 'react-router-dom'

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'About' },
  { to: '/apps', label: 'Apps' },
]

export default function Nav({ user, onSignIn, onSignOut }) {
  const { pathname } = useLocation()

  return (
    <header style={styles.header}>
      <div style={styles.inner}>
        {/* Logo */}
        <Link to="/" style={styles.logo}>JT</Link>

        {/* Nav links */}
        <nav style={styles.links} aria-label="Main navigation">
          {LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              style={{
                ...styles.link,
                ...(pathname === to ? styles.linkActive : {}),
              }}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Auth controls */}
        <div style={styles.auth}>
          {user ? (
            <>
              <span style={styles.email} title={user.email}>{user.email}</span>
              <button
                style={styles.btnOutline}
                onClick={onSignOut}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--border-subtle)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                type="button"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              style={styles.btnFill}
              onClick={onSignIn}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent)' }}
              type="button"
            >
              Sign in
            </button>
          )}
        </div>
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
    gap: '32px',
  },
  logo: {
    fontSize: '0.95rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    color: 'var(--text)',
    flexShrink: 0,
    userSelect: 'none',
  },
  links: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flex: 1,
  },
  link: {
    padding: '5px 12px',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--text-muted)',
    transition: 'color 0.12s ease, background 0.12s ease',
  },
  linkActive: {
    color: 'var(--text)',
    background: 'var(--border-subtle)',
  },
  auth: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
  },
  email: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    maxWidth: '180px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  btnBase: {
    padding: '6px 16px',
    borderRadius: '6px',
    fontSize: '0.8rem',
    fontWeight: 500,
    border: '1px solid transparent',
    lineHeight: 1.5,
    transition: 'background 0.12s ease',
  },
  get btnFill() {
    return {
      ...this.btnBase,
      background: 'var(--accent)',
      color: '#fff',
      borderColor: 'var(--accent)',
    }
  },
  get btnOutline() {
    return {
      ...this.btnBase,
      background: 'transparent',
      color: 'var(--text-muted)',
      borderColor: 'var(--border)',
    }
  },
}

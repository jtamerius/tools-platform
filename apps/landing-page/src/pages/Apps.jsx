import { useState } from 'react'
import AppCard from '../components/AppCard'
import { APPS } from '../config/apps'

/**
 * Determine whether the current user can access an app.
 *  - Public apps are always accessible.
 *  - Protected apps require a signed-in user whose Cognito groups include
 *    the app's requiredGroup (or any protected app when requiredGroup is null).
 */
function isAppAccessible(app, user, groups) {
  if (app.isPublic) return true
  if (!user) return false
  if (!app.requiredGroup) return true
  return groups.includes(app.requiredGroup)
}

export default function Apps({ user, groups, isLoading, onSignIn }) {
  // null = undecided, true = guest, false = will sign in (modal handled by parent)
  const [guestMode, setGuestMode] = useState(null)

  const showGate = !user && guestMode === null

  const appsWithAccess = APPS.map((app) => ({
    ...app,
    isAccessible: isAppAccessible(app, user, groups),
  }))

  // In guest mode without a signed-in user, only show public apps
  const visibleApps = (!user && guestMode === true)
    ? appsWithAccess.filter((app) => app.isPublic)
    : appsWithAccess

  const protectedCount = APPS.filter((a) => !a.isPublic).length

  if (isLoading) {
    return (
      <main style={styles.main}>
        <div style={styles.loading}>Loading&hellip;</div>
      </main>
    )
  }

  return (
    <main style={styles.main}>
      {/* Page header */}
      <div style={styles.header}>
        <p style={styles.eyebrow}>Platform</p>
        <h1 style={styles.heading}>Apps</h1>
        <p style={styles.subheading}>
          {user
            ? `Signed in as ${user.email}`
            : 'Browse available tools and applications.'}
        </p>
      </div>

      {/* Auth gate — shown only when not signed in and no choice made yet */}
      {showGate && (
        <div style={styles.gate}>
          <div style={styles.gateInner}>
            <div style={styles.gateIcon}>⚡</div>
            <h2 style={styles.gateHeading}>How would you like to continue?</h2>
            <p style={styles.gateBody}>
              Sign in to access all apps you're authorized for.{' '}
              {protectedCount > 0 && (
                <>{protectedCount} app{protectedCount !== 1 ? 's' : ''} require{protectedCount === 1 ? 's' : ''} sign-in.</>
              )}{' '}
              Or continue as a guest to browse public apps only.
            </p>
            <div style={styles.gateActions}>
              <button
                style={styles.btnPrimary}
                onClick={onSignIn}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent)' }}
                type="button"
              >
                Sign in
              </button>
              <button
                style={styles.btnOutline}
                onClick={() => setGuestMode(true)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--border-subtle)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                type="button"
              >
                Continue as guest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* App grid — shown once user is signed in or guest mode chosen */}
      {!showGate && (
        <>
          {/* Guest mode banner */}
          {!user && guestMode === true && protectedCount > 0 && (
            <div style={styles.banner}>
              <span>Viewing public apps only.</span>
              <button
                style={styles.bannerLink}
                onClick={onSignIn}
                type="button"
              >
                Sign in to see all apps →
              </button>
            </div>
          )}

          <div style={styles.grid}>
            {visibleApps.map((app) => (
              <AppCard
                key={app.id}
                name={app.name}
                description={app.description}
                url={app.url}
                isPublic={app.isPublic}
                isAccessible={app.isAccessible}
                requiredGroup={app.requiredGroup}
              />
            ))}
          </div>

          {visibleApps.length === 0 && (
            <p style={styles.empty}>No apps available.</p>
          )}
        </>
      )}
    </main>
  )
}

const styles = {
  main: {
    flex: 1,
    maxWidth: 'var(--max-w)',
    width: '100%',
    margin: '0 auto',
    padding: '72px 24px 80px',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '200px',
    fontSize: '0.9rem',
    color: 'var(--text-faint)',
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
  // Auth gate
  gate: {
    display: 'flex',
    justifyContent: 'center',
  },
  gateInner: {
    width: '100%',
    maxWidth: '480px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    padding: '40px 36px',
    textAlign: 'center',
  },
  gateIcon: {
    fontSize: '2rem',
    marginBottom: '20px',
  },
  gateHeading: {
    fontSize: '1.25rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
    marginBottom: '12px',
  },
  gateBody: {
    fontSize: '0.9rem',
    color: 'var(--text-muted)',
    lineHeight: 1.65,
    marginBottom: '28px',
  },
  gateActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  btnBase: {
    width: '100%',
    padding: '11px 20px',
    borderRadius: '8px',
    fontSize: '0.9rem',
    fontWeight: 600,
    border: '1px solid transparent',
    transition: 'background 0.12s ease',
    letterSpacing: '-0.01em',
  },
  get btnPrimary() {
    return { ...this.btnBase, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
  },
  get btnOutline() {
    return { ...this.btnBase, background: 'transparent', color: 'var(--text)', borderColor: 'var(--border)' }
  },
  // Guest banner
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '28px',
    fontSize: '0.875rem',
    color: 'var(--text-muted)',
  },
  bannerLink: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--text)',
    cursor: 'pointer',
    marginLeft: 'auto',
    flexShrink: 0,
  },
  // Grid
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '20px',
  },
  empty: {
    fontSize: '0.9rem',
    color: 'var(--text-faint)',
    textAlign: 'center',
    paddingTop: '40px',
  },
}

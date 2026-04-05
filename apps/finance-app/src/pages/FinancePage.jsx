import IframeViewer from '../components/IframeViewer'

const FINANCE_URL = 'https://jtamerius.com/finance/'

export default function FinancePage({ user, groups, isLoading, onSignIn }) {
  if (isLoading) {
    return (
      <div style={s.center}>
        <div style={s.spinner} aria-label="Loading…" />
      </div>
    )
  }

  if (!user) {
    return (
      <div style={s.center}>
        <div style={s.card}>
          <h2 style={s.heading}>Finance Tracker</h2>
          <p style={s.body}>Sign in with a member account to access the finance tracker.</p>
          <button
            style={s.btn}
            onClick={onSignIn}
            type="button"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent)' }}
          >
            Sign in
          </button>
        </div>
      </div>
    )
  }

  if (!groups.includes('member')) {
    return (
      <div style={s.center}>
        <div style={s.card}>
          <h2 style={s.heading}>Access Denied</h2>
          <p style={s.body}>Your account doesn't have access to the Finance Tracker. Contact the administrator if you believe this is an error.</p>
        </div>
      </div>
    )
  }

  return <IframeViewer src={FINANCE_URL} title="Finance Tracker" />
}

const s = {
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '40px 36px',
    maxWidth: '400px',
    width: '100%',
    textAlign: 'center',
  },
  heading: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: '10px',
    letterSpacing: '-0.02em',
  },
  body: {
    fontSize: '0.9rem',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    marginBottom: '24px',
  },
  btn: {
    padding: '10px 28px',
    borderRadius: 'var(--radius)',
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: '0.9rem',
    fontWeight: 600,
    transition: 'background 0.12s ease',
  },
  spinner: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '3px solid var(--border)',
    borderTopColor: 'var(--text)',
    animation: 'spin 0.7s linear infinite',
  },
}

/**
 * AuthBar
 *
 * Top navigation bar that shows the platform title and auth controls.
 *
 * Props:
 *   user      {object|null}  - { email, username } or null when signed out
 *   onSignIn  {function}     - called when the "Sign in" button is clicked
 *   onSignOut {function}     - called when the "Sign out" button is clicked
 */
export default function AuthBar({ user, onSignIn, onSignOut }) {
  const barStyle = {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    height: '56px',
    background: '#ffffff',
    borderBottom: '1px solid #e0e0e0',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  }

  const titleStyle = {
    fontSize: '1.05rem',
    fontWeight: 700,
    color: '#111',
    letterSpacing: '-0.01em',
    userSelect: 'none',
  }

  const rightSideStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  }

  const emailStyle = {
    fontSize: '0.875rem',
    color: '#555',
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  const btnBase = {
    padding: '6px 16px',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    border: '1px solid transparent',
    lineHeight: 1.4,
    transition: 'background 0.15s ease, border-color 0.15s ease',
  }

  const signInBtn = {
    ...btnBase,
    background: '#111',
    color: '#fff',
    borderColor: '#111',
  }

  const signOutBtn = {
    ...btnBase,
    background: 'transparent',
    color: '#444',
    borderColor: '#d0d0d0',
  }

  function handleSignInHover(e) {
    e.currentTarget.style.background = '#333'
    e.currentTarget.style.borderColor = '#333'
  }
  function handleSignInLeave(e) {
    e.currentTarget.style.background = '#111'
    e.currentTarget.style.borderColor = '#111'
  }
  function handleSignOutHover(e) {
    e.currentTarget.style.background = '#f5f5f5'
  }
  function handleSignOutLeave(e) {
    e.currentTarget.style.background = 'transparent'
  }

  return (
    <header style={barStyle} role="banner">
      <span style={titleStyle}>Internal Tools</span>
      <div style={rightSideStyle}>
        {user ? (
          <>
            <span style={emailStyle} title={user.email}>{user.email}</span>
            <button
              style={signOutBtn}
              onClick={onSignOut}
              onMouseEnter={handleSignOutHover}
              onMouseLeave={handleSignOutLeave}
              type="button"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            style={signInBtn}
            onClick={onSignIn}
            onMouseEnter={handleSignInHover}
            onMouseLeave={handleSignInLeave}
            type="button"
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  )
}

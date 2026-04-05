import { useState, useEffect, useRef } from 'react'
import { APPS } from '@tools/config'

const LANDING_URL = import.meta.env.VITE_ENV === 'production'
  ? 'https://tools.jtamerius.com'
  : 'https://staging.d223wq48sddq6t.amplifyapp.com'

// Default Home/About links point to the landing page.
// Apps that handle these routes internally (e.g. landing-page with HashRouter)
// should pass their own extraLinks to override.
const DEFAULT_NAV_LINKS = [
  { label: 'Home', href: LANDING_URL },
  { label: 'About', href: `${LANDING_URL}/#/about` },
]

/**
 * Shared platform navigation bar used by all apps.
 *
 * @param {{
 *   appTitle?: string         — subtitle next to JT logo (e.g. "Ensemble Weather")
 *   currentAppId?: string     — id from APPS; excluded from the dropdown
 *   extraLinks?: Array<{label: string, href: string}> — nav links before the Apps dropdown (defaults to Home + About)
 *   user?: {email: string}    — authenticated user; renders email + Sign out
 *   onSignIn?: () => void     — if provided, renders Sign in button when logged out
 *   onSignOut?: () => void    — called on Sign out click
 * }} props
 */
export function Nav({ appTitle, currentAppId, extraLinks = DEFAULT_NAV_LINKS, user, onSignIn, onSignOut }) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const dropdownApps = APPS.filter(a => a.id !== currentAppId)

  return (
    <header style={s.header}>
      <div style={s.inner}>
        <a href={LANDING_URL} style={s.logo}>JT</a>
        {appTitle && <span style={s.appTitle}>{appTitle}</span>}

        <div style={s.right}>
          {extraLinks.map(({ label, href }) => (
            <a key={href} href={href} style={s.navLink}>{label}</a>
          ))}

          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              style={s.appsBtn}
              onClick={() => setOpen(o => !o)}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--border-subtle)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              type="button"
            >
              Apps {open ? '▴' : '▾'}
            </button>
            {open && (
              <div style={s.dropdown}>
                {dropdownApps.map((app, i) => (
                  <a
                    key={app.id}
                    href={app.url}
                    style={{ ...s.dropdownItem, ...(i < dropdownApps.length - 1 ? s.dropdownItemBorder : {}) }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--border-subtle)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={s.dropdownName}>{app.name}</span>
                    <span style={s.dropdownDesc}>{app.description}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          {user ? (
            <>
              <span style={s.email} title={user.email}>{user.email}</span>
              <button
                style={s.btnOutline}
                onClick={onSignOut}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--border-subtle)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                type="button"
              >
                Sign out
              </button>
            </>
          ) : onSignIn ? (
            <button
              style={s.btnFill}
              onClick={onSignIn}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)' }}
              type="button"
            >
              Sign in
            </button>
          ) : null}
        </div>
      </div>
    </header>
  )
}

const btnBase = {
  padding: '6px 16px',
  borderRadius: '6px',
  fontSize: '0.8rem',
  fontWeight: 500,
  border: '1px solid transparent',
  lineHeight: 1.5,
  transition: 'background 0.12s ease',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const s = {
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
    textDecoration: 'none',
    userSelect: 'none',
    flexShrink: 0,
  },
  appTitle: {
    fontSize: '0.875rem',
    color: 'var(--text-muted)',
    fontWeight: 500,
    flexShrink: 0,
  },
  right: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  navLink: {
    padding: '5px 12px',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--text-muted)',
    textDecoration: 'none',
    transition: 'color 0.12s ease',
  },
  appsBtn: {
    ...btnBase,
    background: 'transparent',
    color: 'var(--text-muted)',
    borderColor: 'transparent',
    padding: '5px 12px',
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    minWidth: '220px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    overflow: 'hidden',
    zIndex: 200,
  },
  dropdownItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 14px',
    textDecoration: 'none',
    transition: 'background 0.1s ease',
  },
  dropdownItemBorder: {
    borderBottom: '1px solid var(--border-subtle)',
  },
  dropdownName: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--text)',
  },
  dropdownDesc: {
    fontSize: '0.75rem',
    color: 'var(--text-faint)',
  },
  email: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    maxWidth: '180px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginLeft: '8px',
  },
  btnFill: {
    ...btnBase,
    background: 'var(--accent)',
    color: '#fff',
    borderColor: 'var(--accent)',
  },
  btnOutline: {
    ...btnBase,
    background: 'transparent',
    color: 'var(--text-muted)',
    borderColor: 'var(--border)',
  },
}

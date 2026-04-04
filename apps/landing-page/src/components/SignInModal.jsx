import { useState, useEffect, useRef } from 'react'
import { forgotPassword, confirmForgotPassword, createUserPool } from '@tools/auth'

/**
 * SignInModal
 *
 * Handles three views:
 *   'signin'   — email + password form (default)
 *   'forgot'   — email form to request a reset code
 *   'reset'    — code + new-password form to complete the reset
 *
 * Props:
 *   isOpen   {boolean}  - Controls visibility
 *   onClose  {function} - Called when the modal should close
 *   onSignIn {function} - async (email, password) => void
 */
export default function SignInModal({ isOpen, onClose, onSignIn }) {
  const [view, setView] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const emailRef = useRef(null)

  // Reset all state each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setView('signin')
      setEmail('')
      setPassword('')
      setCode('')
      setNewPassword('')
      setError(null)
      setInfo(null)
      setIsSubmitting(false)
      setTimeout(() => emailRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  // ── Sign-in submit ─────────────────────────────────────────────────────────

  async function handleSignIn(e) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await onSignIn(email.trim(), password)
    } catch (err) {
      setError(err.message ?? 'Sign in failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Forgot password: send code ─────────────────────────────────────────────

  async function handleForgotSubmit(e) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const pool = createUserPool(
        import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
        import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
      )
      await forgotPassword(pool, email.trim())
      setInfo(`A reset code was sent to ${email.trim()}.`)
      setView('reset')
    } catch (err) {
      setError(err.message ?? 'Could not send reset code. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Forgot password: confirm new password ──────────────────────────────────

  async function handleResetSubmit(e) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const pool = createUserPool(
        import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
        import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
      )
      await confirmForgotPassword(pool, email.trim(), code.trim(), newPassword)
      setInfo('Password updated. You can now sign in.')
      setView('signin')
      setPassword('')
      setCode('')
      setNewPassword('')
    } catch (err) {
      setError(err.message ?? 'Could not reset password. Check the code and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div style={s.backdrop} onClick={handleBackdropClick} aria-modal="true" role="dialog" aria-labelledby="modal-title">
      <div style={s.dialog}>
        {/* Close button */}
        <button
          style={s.closeBtn}
          onClick={onClose}
          aria-label="Close"
          type="button"
          onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f0f0' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
        >✕</button>

        {/* ── Sign in view ─────────────────────────────────────────────── */}
        {view === 'signin' && (
          <>
            <h2 id="modal-title" style={s.title}>Sign in</h2>
            <p style={s.subtitle}>Access your Internal Tools account.</p>
            {info && <div style={s.infoBox} role="status">{info}</div>}
            {error && <div style={s.errorBox} role="alert">{error}</div>}
            <form onSubmit={handleSignIn} noValidate>
              <div style={s.fields}>
                <label style={s.label}>
                  Email
                  <input ref={emailRef} style={s.input} type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                    required placeholder="you@example.com" disabled={isSubmitting}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--text)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  />
                </label>
                <label style={s.label}>
                  Password
                  <input style={s.input} type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                    required placeholder="••••••••" disabled={isSubmitting}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--text)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  />
                </label>
              </div>
              <button style={{ ...s.submitBtn, background: isSubmitting ? '#555' : 'var(--accent)' }}
                type="submit" disabled={isSubmitting || !email || !password}
                onMouseEnter={(e) => { if (!isSubmitting) e.currentTarget.style.background = 'var(--accent-hover)' }}
                onMouseLeave={(e) => { if (!isSubmitting) e.currentTarget.style.background = 'var(--accent)' }}
              >
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <button style={s.textLink} type="button" onClick={() => { setError(null); setInfo(null); setView('forgot') }}>
              Forgot password?
            </button>
          </>
        )}

        {/* ── Forgot password: request code ────────────────────────────── */}
        {view === 'forgot' && (
          <>
            <h2 id="modal-title" style={s.title}>Reset password</h2>
            <p style={s.subtitle}>Enter your email and we'll send a reset code.</p>
            {error && <div style={s.errorBox} role="alert">{error}</div>}
            <form onSubmit={handleForgotSubmit} noValidate>
              <div style={s.fields}>
                <label style={s.label}>
                  Email
                  <input ref={emailRef} style={s.input} type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                    required placeholder="you@example.com" disabled={isSubmitting}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--text)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  />
                </label>
              </div>
              <button style={{ ...s.submitBtn, background: isSubmitting ? '#555' : 'var(--accent)' }}
                type="submit" disabled={isSubmitting || !email}
                onMouseEnter={(e) => { if (!isSubmitting) e.currentTarget.style.background = 'var(--accent-hover)' }}
                onMouseLeave={(e) => { if (!isSubmitting) e.currentTarget.style.background = 'var(--accent)' }}
              >
                {isSubmitting ? 'Sending…' : 'Send reset code'}
              </button>
            </form>
            <button style={s.textLink} type="button" onClick={() => { setError(null); setView('signin') }}>
              ← Back to sign in
            </button>
          </>
        )}

        {/* ── Forgot password: enter code + new password ───────────────── */}
        {view === 'reset' && (
          <>
            <h2 id="modal-title" style={s.title}>Choose new password</h2>
            <p style={s.subtitle}>Enter the code sent to your email and pick a new password.</p>
            {info && <div style={s.infoBox} role="status">{info}</div>}
            {error && <div style={s.errorBox} role="alert">{error}</div>}
            <form onSubmit={handleResetSubmit} noValidate>
              <div style={s.fields}>
                <label style={s.label}>
                  Verification code
                  <input ref={emailRef} style={s.input} type="text" value={code}
                    onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code"
                    required placeholder="123456" disabled={isSubmitting}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--text)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  />
                </label>
                <label style={s.label}>
                  New password
                  <input style={s.input} type="password" value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password"
                    required placeholder="••••••••" disabled={isSubmitting}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--text)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  />
                </label>
              </div>
              <button style={{ ...s.submitBtn, background: isSubmitting ? '#555' : 'var(--accent)' }}
                type="submit" disabled={isSubmitting || !code || !newPassword}
                onMouseEnter={(e) => { if (!isSubmitting) e.currentTarget.style.background = 'var(--accent-hover)' }}
                onMouseLeave={(e) => { if (!isSubmitting) e.currentTarget.style.background = 'var(--accent)' }}
              >
                {isSubmitting ? 'Updating…' : 'Set new password'}
              </button>
            </form>
            <button style={s.textLink} type="button" onClick={() => { setError(null); setInfo(null); setView('forgot') }}>
              ← Resend code
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const s = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  },
  dialog: {
    background: 'var(--surface)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
    width: '100%', maxWidth: '400px',
    padding: '32px 28px 28px',
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute', top: '14px', right: '14px',
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-faint)', fontSize: '1rem',
    padding: '4px 6px', borderRadius: '4px', lineHeight: 1,
  },
  title: {
    fontSize: '1.2rem', fontWeight: 700,
    letterSpacing: '-0.02em', color: 'var(--text)',
    marginBottom: '6px',
  },
  subtitle: {
    fontSize: '0.875rem', color: 'var(--text-muted)',
    marginBottom: '24px',
  },
  fields: {
    display: 'flex', flexDirection: 'column', gap: '14px',
    marginBottom: '20px',
  },
  label: {
    display: 'flex', flexDirection: 'column', gap: '5px',
    fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)',
  },
  input: {
    padding: '9px 12px', borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    fontSize: '0.9rem', color: 'var(--text)',
    background: 'var(--bg)', outline: 'none',
    transition: 'border-color 0.12s ease',
  },
  errorBox: {
    background: '#fff0f0', border: '1px solid #fca5a5',
    borderRadius: 'var(--radius)', padding: '10px 12px',
    fontSize: '0.85rem', color: '#b91c1c',
    marginBottom: '16px', lineHeight: 1.4,
  },
  infoBox: {
    background: '#f0f9ff', border: '1px solid #bae6fd',
    borderRadius: 'var(--radius)', padding: '10px 12px',
    fontSize: '0.85rem', color: '#0369a1',
    marginBottom: '16px', lineHeight: 1.4,
  },
  submitBtn: {
    width: '100%', padding: '10px', borderRadius: 'var(--radius)',
    border: 'none', color: '#fff',
    fontSize: '0.9rem', fontWeight: 600,
    transition: 'background 0.12s ease', marginBottom: '16px',
  },
  textLink: {
    display: 'block', width: '100%', textAlign: 'center',
    background: 'none', border: 'none', padding: '4px',
    fontSize: '0.8rem', color: 'var(--text-muted)',
    cursor: 'pointer',
  },
}

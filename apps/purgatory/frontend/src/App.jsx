import { useState } from 'react'
import { useAuth } from '@tools/auth'
import Nav from './components/Nav'
import ReviewPage from './pages/ReviewPage'

const AUTH_CONFIG = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
}

const overlay = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }
const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, width: 340, display: 'flex', flexDirection: 'column', gap: 12 }
const inp = { padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit', fontSize: 14 }
const btn = { padding: '10px 0', borderRadius: 8, background: 'var(--accent)', color: '#000', border: 'none', fontSize: 14, fontWeight: 600 }
const errStyle = { color: 'var(--red)', fontSize: 13, margin: 0 }

export default function App() {
  const { user, isLoading, signIn, signOut, completeNewPasswordChallenge, getAccessToken } = useAuth(AUTH_CONFIG)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const [newPw, setNewPw] = useState('')

  if (isLoading) return null

  if (!user) {
    if (pending) {
      return (
        <div style={overlay}>
          <form style={card} onSubmit={async e => {
            e.preventDefault()
            setError('')
            try { await completeNewPasswordChallenge(pending, newPw) } catch (err) { setError(err.message) }
          }}>
            <h2 style={{ margin: 0 }}>Set new password</h2>
            <input autoFocus type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} style={inp} />
            {error && <p style={errStyle}>{error}</p>}
            <button type="submit" style={btn}>Set password</button>
          </form>
        </div>
      )
    }
    return (
      <div style={overlay}>
        <form style={card} onSubmit={async e => {
          e.preventDefault()
          setError('')
          try {
            await signIn(email, password)
          } catch (err) {
            if (err.code === 'NewPasswordRequired') setPending(err.cognitoUser)
            else setError(err.message ?? 'Sign-in failed')
          }
        }}>
          <h2 style={{ margin: 0 }}>Purgatory Review</h2>
          <input autoFocus type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={inp} />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={inp} />
          {error && <p style={errStyle}>{error}</p>}
          <button type="submit" style={btn}>Sign in</button>
        </form>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Nav user={user} onSignOut={signOut} />
      <ReviewPage getAccessToken={getAccessToken} />
    </div>
  )
}

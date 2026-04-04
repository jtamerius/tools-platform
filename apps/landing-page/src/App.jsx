import { useState } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { useAuth } from '@tools/auth'
import Nav from './components/Nav'
import SignInModal from './components/SignInModal'
import Home from './pages/Home'
import About from './pages/About'
import Apps from './pages/Apps'

const AUTH_CONFIG = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
}

export default function App() {
  const { user, groups, isLoading, signIn, signOut } = useAuth(AUTH_CONFIG)
  const [modalOpen, setModalOpen] = useState(false)

  function openSignIn() {
    setModalOpen(true)
  }

  return (
    <HashRouter>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <Nav user={user} onSignIn={openSignIn} onSignOut={signOut} />

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route
            path="/apps"
            element={
              <Apps
                user={user}
                groups={groups}
                isLoading={isLoading}
                onSignIn={openSignIn}
              />
            }
          />
        </Routes>

        <SignInModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSignIn={async (email, password) => {
            await signIn(email, password)
            setModalOpen(false)
          }}
        />
      </div>
    </HashRouter>
  )
}

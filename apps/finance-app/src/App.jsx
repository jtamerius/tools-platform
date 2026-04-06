import { useState } from 'react'
import { useAuth } from '@tools/auth'
import Nav from './components/Nav'
import SignInModal from './components/SignInModal'
import FinancePage from './pages/FinancePage'

const AUTH_CONFIG = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
}

export default function App() {
  const { user, groups, isLoading, signIn, signOut, completeNewPasswordChallenge } = useAuth(AUTH_CONFIG)
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Nav user={user} onSignIn={() => setModalOpen(true)} onSignOut={signOut} />

      <FinancePage
        user={user}
        groups={groups}
        isLoading={isLoading}
        onSignIn={() => setModalOpen(true)}
      />

      <SignInModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSignIn={async (email, password) => {
          await signIn(email, password)
          setModalOpen(false)
        }}
        onNewPassword={async (cognitoUser, newPassword) => {
          await completeNewPasswordChallenge(cognitoUser, newPassword)
          setModalOpen(false)
        }}
      />
    </div>
  )
}

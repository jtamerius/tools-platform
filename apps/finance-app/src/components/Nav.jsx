import { Nav } from '@tools/ui'

export default function AppNav({ user, onSignIn, onSignOut }) {
  return (
    <Nav
      appTitle="Finance Tracker"
      currentAppId="finance-app"
      user={user}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
    />
  )
}

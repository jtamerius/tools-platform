import { Nav } from '@tools/ui'

export default function AppNav({ user, onSignOut }) {
  return (
    <Nav
      appTitle="Finance Tracker"
      currentAppId="finance-app"
      user={user}
      onSignOut={onSignOut}
    />
  )
}

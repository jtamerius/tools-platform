import { Nav } from '@tools/ui'

export default function AppNav({ user, onSignOut }) {
  return (
    <Nav
      appTitle="Purgatory Crowding"
      currentAppId="purgatory"
      user={user}
      onSignOut={onSignOut}
    />
  )
}

---
name: nav-standard
description: Apply or update the shared platform navigation bar. Use this when adding the shared Nav to a new app, or when updating Nav behavior (dropdown apps, auth controls, extra links).
---

# Platform Nav Standard

All apps in the tools platform use a single shared `Nav` component from `@tools/ui`.
**Never write a custom Nav from scratch** — update the shared component or pass props.

## Component location

```
shared/ui/src/Nav.jsx     ← authoritative source
shared/ui/src/index.js    ← exports Nav
```

## App registry

All apps are registered in `shared/config/src/apps.js` and exported from `@tools/config`.
When you add a new app, add its entry there — **not** in a local file.

## Usage per app type

### Public app (no auth)
```jsx
// src/components/Nav.jsx
import { Nav } from '@tools/ui'

export default function AppNav() {
  return <Nav appTitle="My App" currentAppId="my-app" />
}
```

### Auth-gated app
```jsx
// src/components/Nav.jsx
import { Nav } from '@tools/ui'

export default function AppNav({ user, onSignIn, onSignOut }) {
  return (
    <Nav
      appTitle="My App"
      currentAppId="my-app"
      user={user}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
    />
  )
}
```

### Landing page (extra internal links)
```jsx
// src/components/Nav.jsx
import { Nav } from '@tools/ui'

const EXTRA_LINKS = [
  { label: 'Home', href: '#/' },
  { label: 'About', href: '#/about' },
]

export default function AppNav({ user, onSignIn, onSignOut }) {
  return (
    <Nav
      currentAppId="landing-page"
      extraLinks={EXTRA_LINKS}
      user={user}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
    />
  )
}
```

## Props reference

| Prop | Type | Description |
|------|------|-------------|
| `appTitle` | `string?` | Subtitle shown next to the JT logo |
| `currentAppId` | `string?` | App's `id` from APPS registry — excluded from the dropdown |
| `extraLinks` | `{label, href}[]?` | Additional nav links rendered before the Apps dropdown |
| `user` | `{email: string}?` | Authenticated user; shows email + Sign out |
| `onSignIn` | `() => void?` | If provided, renders Sign in button when logged out |
| `onSignOut` | `() => void?` | Called on Sign out click |

## package.json requirements

Every app that uses Nav must declare:
```json
"@tools/ui": "*",
"@tools/config": "*"
```

## Adding a new app to the dropdown

1. Add an entry to `shared/config/src/apps.js`
2. The dropdown updates automatically in all apps on next build — no other changes needed

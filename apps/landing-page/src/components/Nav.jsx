import { Nav } from '@tools/ui'

const EXTRA_LINKS = [
  { label: 'Home', href: '#/' },
  { label: 'About', href: '#/about' },
]

export default function AppNav() {
  return (
    <Nav
      currentAppId="landing-page"
      extraLinks={EXTRA_LINKS}
    />
  )
}

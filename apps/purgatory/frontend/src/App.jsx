import Nav from './components/Nav'
import ReviewPage from './pages/ReviewPage'

// This app is intentionally unauthenticated. The API carries no authorizer
// either, so the review UI — including count corrections — is open to anyone
// with the URL.
export default function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Nav />
      <ReviewPage />
    </div>
  )
}

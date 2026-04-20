import Nav from './components/Nav'
import FinancePage from './pages/FinancePage'

export default function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Nav />
      <FinancePage />
    </div>
  )
}

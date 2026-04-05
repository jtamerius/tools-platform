import Nav from './components/Nav'
import WeatherPage from './pages/WeatherPage'

export default function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Nav />
      <WeatherPage />
    </div>
  )
}

import { useEffect } from 'react'
import HailstonedCard from '../components/HailstonedCard'
import WeatherCard from '../components/WeatherCard'
import PurgatoryCard from '../components/PurgatoryCard'

export default function Home() {
  useEffect(() => {
    const prev = document.body.style.background
    document.body.style.background = '#0b0d18'
    return () => { document.body.style.background = prev }
  }, [])

  return (
    <main style={S.main}>
      <div style={S.grid}>
        <HailstonedCard />
        <WeatherCard />
        <PurgatoryCard />
      </div>
    </main>
  )
}

const S = {
  main: {
    flex: 1,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
    background: 'radial-gradient(ellipse at 30% 30%, #131830 0%, #0b0d18 60%), #0b0d18',
    gap: '36px',
  },
  grid: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
}

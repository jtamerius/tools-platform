import { HashRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import About from './pages/About'
import Apps from './pages/Apps'

export default function App() {
  return (
    <HashRouter>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/apps" element={<Apps />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

import { useNavigate } from 'react-router-dom'

export default function BackButton() {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate('/')}
      style={{
        position: 'fixed',
        top: '20px',
        left: '24px',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        background: 'var(--bg)',
        color: 'var(--text-muted)',
        fontSize: '0.8rem',
        cursor: 'pointer',
        opacity: 0.85,
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--text)' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      ← Home
    </button>
  )
}

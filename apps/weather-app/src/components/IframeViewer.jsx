import { useState } from 'react'

export default function IframeViewer({ src, title }) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - var(--nav-height))', overflow: 'hidden' }}>
      {!loaded && (
        <div style={styles.skeleton} aria-label="Loading…" />
      )}
      <iframe
        src={src}
        title={title}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}

const styles = {
  skeleton: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(90deg, var(--border-subtle) 25%, var(--border) 50%, var(--border-subtle) 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.4s infinite',
  },
}

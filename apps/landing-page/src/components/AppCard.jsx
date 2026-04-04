/**
 * AppCard
 *
 * Props:
 *   name          {string}  - Display name of the app
 *   description   {string}  - Short description
 *   url           {string}  - Destination URL
 *   isPublic      {boolean} - Whether the app is publicly accessible
 *   isAccessible  {boolean} - Whether the current user may access the app
 *   requiredGroup {string|null} - Cognito group required to access the app
 */
export default function AppCard({ name, description, url, isPublic, isAccessible, requiredGroup }) {
  const badge = isPublic
    ? { label: 'Public', bg: '#e8f5e9', color: '#2e7d32' }
    : { label: 'Members Only', bg: '#fff8e1', color: '#f57f17' }

  const tooltipText = !isAccessible
    ? requiredGroup
      ? 'Ask admin for access'
      : 'Sign in required'
    : null

  const cardBase = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    background: '#ffffff',
    borderRadius: '10px',
    padding: '20px 22px',
    border: '1px solid #e0e0e0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    transition: 'box-shadow 0.15s ease, transform 0.15s ease',
    minHeight: '150px',
    textDecoration: 'none',
    color: 'inherit',
  }

  const cardAccessible = {
    ...cardBase,
    cursor: 'pointer',
  }

  const cardLocked = {
    ...cardBase,
    opacity: 0.6,
    cursor: 'not-allowed',
    background: '#fafafa',
  }

  const headerRow = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
  }

  const nameStyle = {
    fontSize: '1.05rem',
    fontWeight: 600,
    color: '#111',
    lineHeight: 1.3,
  }

  const badgeStyle = {
    flexShrink: 0,
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    padding: '2px 8px',
    borderRadius: '99px',
    background: badge.bg,
    color: badge.color,
    whiteSpace: 'nowrap',
  }

  const descStyle = {
    fontSize: '0.9rem',
    color: '#555',
    lineHeight: 1.5,
    flexGrow: 1,
  }

  const lockRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '0.8rem',
    color: '#888',
    marginTop: 'auto',
  }

  const lockIconStyle = {
    fontSize: '0.9rem',
  }

  // Hover effect via a state-free CSS class approach using onMouseEnter/Leave
  // on the wrapper is cleaner than maintaining a hovered state per card.
  function handleMouseEnter(e) {
    if (!isAccessible) return
    e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.12)'
    e.currentTarget.style.transform = 'translateY(-2px)'
  }

  function handleMouseLeave(e) {
    if (!isAccessible) return
    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'
    e.currentTarget.style.transform = 'translateY(0)'
  }

  const cardStyle = isAccessible ? cardAccessible : cardLocked

  const inner = (
    <>
      <div style={headerRow}>
        <span style={nameStyle}>{name}</span>
        <span style={badgeStyle}>{badge.label}</span>
      </div>
      <p style={descStyle}>{description}</p>
      {!isAccessible && (
        <div style={lockRowStyle}>
          <span style={lockIconStyle}>🔒</span>
          <span>{tooltipText}</span>
        </div>
      )}
    </>
  )

  if (isAccessible) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={cardStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        aria-label={`Open ${name}`}
      >
        {inner}
      </a>
    )
  }

  return (
    <div
      style={cardStyle}
      aria-disabled="true"
      role="article"
      aria-label={`${name} — ${tooltipText}`}
    >
      {inner}
    </div>
  )
}

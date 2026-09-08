const STATES = {
  ok:     { label: 'OK',           color: 'var(--health-ok)' },
  lag:    { label: 'LAGGING',      color: 'var(--health-lag)' },
  view:   { label: 'VIEW CHANGED', color: 'var(--health-view)' },
  dark:   { label: 'DARK',         color: 'var(--health-dark)' },
}

/**
 * Instrument state, structurally outside the traffic ramp.
 *
 * Health never borrows a deviation colour, and violet is used nowhere else on
 * the page, so a camera whose view changed cannot be mistaken for a camera
 * that is simply busy.
 */
export default function HealthChip({ state = 'ok', detail, compact }) {
  const s = STATES[state] ?? STATES.ok
  if (state === 'ok' && compact) return null
  return (
    <span
      title={detail || s.label}
      className="label"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        color: s.color, border: `1px solid ${s.color}`,
        borderRadius: 'var(--r-chip)', padding: '1px 5px',
        fontSize: 9.5, letterSpacing: '0.06em', whiteSpace: 'nowrap',
        background: state === 'dark' ? 'var(--hatch)' : 'transparent',
      }}
    >
      {s.label}
    </span>
  )
}

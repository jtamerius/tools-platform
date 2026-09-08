/**
 * Current vehicle count, drawn as one dot per vehicle.
 *
 * Per-camera counts are small integers — 0, 1, 2, rarely above 8, never above
 * 18 in the whole record. A bar chart of that is a lie about resolution; a
 * numeral is a thing to read rather than see. Dots are countable at a glance
 * and make an empty frame visibly empty rather than a printed "0".
 */
export default function UnitDots({ count, max = 6, stale }) {
  if (count == null) return <span className="micro" style={{ color: 'var(--txt-faint)' }}>—</span>
  const shown = Math.min(count, max)
  const overflow = count - shown
  return (
    <span
      title={`${count} vehicle${count === 1 ? '' : 's'} in frame`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
    >
      {count === 0 && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          border: '1px solid var(--rule-strong)', opacity: stale ? 0.4 : 1,
        }} />
      )}
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: stale ? 'var(--health-dark)' : 'var(--txt-hi)',
        }} />
      ))}
      {overflow > 0 && (
        <span className="mono" style={{ fontSize: 10, color: 'var(--txt-lo)' }}>+{overflow}</span>
      )}
    </span>
  )
}

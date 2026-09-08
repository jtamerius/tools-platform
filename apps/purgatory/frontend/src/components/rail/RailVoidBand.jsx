import { VOID } from '../../lib/cams'

/**
 * The unmonitored gap in the corridor, named as geography.
 *
 * Between the resort pair at MP 48.6 and the next camera at MP 25.65 there are
 * 23 miles and 21 minutes of driving this system cannot see. Ten evenly spaced
 * rows would imply even coverage along the road; this band says otherwise,
 * which is the honest rendering and also the more interesting one.
 */
export default function RailVoidBand() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '7px 12px', background: 'var(--ink-900)',
    }}>
      <div style={{ flex: 'none', width: 78, borderTop: '1px dashed var(--rule-strong)' }} />
      <span className="label" style={{ fontSize: 10, color: 'var(--txt-faint)', letterSpacing: '0.1em' }}>
        {VOID.miles} mi unmonitored · {VOID.minutes} min driving · no cameras
      </span>
      <div style={{ flex: 1, borderTop: '1px dashed var(--rule-strong)' }} />
    </div>
  )
}

import { RWIS } from '../../lib/cams'
import { GRID } from './CameraRow'
import { ago } from '../../lib/stats'

/**
 * Road-weather as an eleventh instrument rather than a footer of dashes.
 *
 * The feed died on 2026-08-12 when CDOT retired the GraphQL API behind it. A
 * row that renders its own outage in the same grammar as the live cameras is
 * honest; six em-dashes under a heading reading "Current conditions" is not.
 */
export default function RwisRow({ rwis }) {
  const live = rwis?.at && (Date.now() - new Date(rwis.at).getTime()) <= 20 * 60 * 1000
  const tone = live ? 'var(--health-ok)' : 'var(--health-dark)'
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 10, alignItems: 'center',
      height: 44, padding: '0 12px', borderLeft: '2px solid transparent',
    }}>
      <div style={{
        width: 78, height: 44, borderRadius: 'var(--r-img)', flex: 'none',
        background: 'repeating-linear-gradient(45deg, transparent 0 3px, var(--rule-strong) 3px 4px)',
      }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', color: 'var(--txt)', fontSize: 12.5 }}>Road weather</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--txt-faint)' }}>
          MP {RWIS.mp} · station {RWIS.station}
        </span>
      </span>
      <span />
      <span />
      <span />
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="label" style={{
          fontSize: 9.5, color: tone, border: `1px solid ${tone}`,
          borderRadius: 'var(--r-chip)', padding: '1px 5px', letterSpacing: '0.06em',
        }}>{live ? 'LIVE' : 'FEED DOWN'}</span>
        <span style={{ fontSize: 12, color: 'var(--txt-faint)' }}>
          {rwis?.at ? `last reading ${ago(rwis.at)} ago` : 'upstream API retired'}
        </span>
      </span>
    </div>
  )
}

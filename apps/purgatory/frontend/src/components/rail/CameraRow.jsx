import CamThumb from '../marks/CamThumb'
import UnitDots from '../marks/UnitDots'
import Sparkline from '../marks/Sparkline'
import HealthChip from '../marks/HealthChip'
import { devToken, devPhrase, fmtPct, ago } from '../../lib/stats'

const GRID = '78px 118px 56px 108px 44px 1fr'

export default function CameraRow({ cam, row, api, selected, onSelect }) {
  const { latestSk, count, spark, bandTop, pct, n, occupancy, health, healthDetail, lastAt } = row || {}
  // Health gates the ramp: a camera whose view changed can never take a
  // traffic hue, because its numbers no longer mean what the ramp assumes.
  const gated = health && health !== 'ok'
  const tone = gated ? 'var(--health-dark)' : devToken(pct)

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect?.(cam.id, latestSk)}
      style={{
        display: 'grid', gridTemplateColumns: GRID, gap: 10, alignItems: 'center',
        width: '100%', height: 44, padding: '0 12px', textAlign: 'left',
        background: selected ? 'var(--ink-700)' : 'var(--ink-800)',
        borderLeft: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
      }}
    >
      <CamThumb api={api} camId={cam.id} sk={latestSk} alt={`${cam.place} camera, ${cam.id}`} />

      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block', color: 'var(--txt-hi)', fontSize: 12.5, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{cam.place}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--txt-faint)' }}>
          MP {cam.mp} · {cam.km} km
        </span>
      </span>

      <UnitDots count={count} stale={gated} />

      <Sparkline points={spark} bandTop={bandTop} tone={tone} />

      <span className="mono" style={{ fontSize: 12, color: 'var(--txt-hi)', textAlign: 'right' }}>
        {fmtPct(occupancy)}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {gated
          ? <HealthChip state={health} detail={healthDetail} />
          : <span style={{ fontSize: 12, color: pct == null ? 'var(--txt-faint)' : 'var(--txt)' }}>
              {devPhrase(pct, n)}
            </span>}
        {lastAt && (
          <span className="micro" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{ago(lastAt)}</span>
        )}
      </span>
    </button>
  )
}

export { GRID }

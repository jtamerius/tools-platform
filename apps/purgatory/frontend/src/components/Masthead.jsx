import { ago } from '../lib/stats'

const TONE = {
  view: 'var(--health-view)', hi: 'var(--dev-hi)', lo: 'var(--dev-far-lo)',
  lag: 'var(--health-lag)', typ: 'var(--txt-hi)',
}

export default function Masthead({ headline, summary, daysOfRecord, frames }) {
  const stale = !summary?.newest || (Date.now() - new Date(summary.newest).getTime()) > 20 * 60 * 1000
  return (
    <header style={{
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'start',
      padding: '20px 0 22px', borderBottom: '1px solid var(--rule)',
    }}>
      <div style={{ minWidth: 0 }}>
        <p className="label" style={{ letterSpacing: '0.10em', marginBottom: 10 }}>
          US-550 · Durango → Purgatory Resort
        </p>
        <h1 style={{
          maxWidth: '30ch', color: TONE[headline?.tone] ?? 'var(--txt-hi)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {headline?.lede ?? ' '}
        </h1>
        <p style={{ marginTop: 10, maxWidth: '62ch', color: 'var(--txt)', fontSize: 'var(--fs-body)' }}>
          Ten CDOT cameras, one frame every 15 minutes since 20 May — {daysOfRecord} days,
          {' '}{frames ? frames.toLocaleString() : '—'} frames, zero missing days. A YOLO detector
          counts the vehicles in each frame. This page reads them and rewrites itself every quarter hour.
        </p>
      </div>

      <div style={{ textAlign: 'right', flex: 'none' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span className="live-dot" data-stale={stale ? 'true' : 'false'} />
          <span className="label" style={{ color: stale ? 'var(--health-lag)' : 'var(--txt-lo)' }}>
            {stale ? 'STALE' : 'LIVE'} · LAST FRAME {summary?.newest ? ago(summary.newest) : '—'} AGO
          </span>
        </span>
        <p className="label" style={{ marginTop: 8, color: 'var(--txt-faint)' }}>
          RESORT CLOSED · SUMMER COMMUTER REGIME
        </p>
      </div>
    </header>
  )
}

import { CAM_IDS } from './cams'

/**
 * Camera-health detection by changepoint scan.
 *
 * Camera 3291-E lost roughly three quarters of its counts between the weeks of
 * 2026-07-06 and 2026-07-13 and never recovered. Detector confidence and image
 * brightness were unchanged across the drop, so the model was fine — the frame
 * content changed.
 *
 * The test is that distinction: a large SUSTAINED drop in counts WITHOUT a
 * matching drop in detector confidence means the camera is looking somewhere
 * else, not that the road went quiet.
 *
 * Crucially this scans the WHOLE series for the step rather than comparing a
 * trailing window against the one before it. A trailing comparison only sees a
 * break while it is still recent: two months on, the broken level has become
 * its own baseline and the camera reads as healthy again. That is exactly how
 * 3291-E stayed invisible, and a detector that reproduces the bug it exists to
 * catch is worse than none.
 */
const MIN_SIDE = 14        // days required either side of a candidate split
const DROP_RATIO = 0.6     // after < 60% of before
const CONF_TOLERANCE = 0.05
const RECOVERY_RATIO = 0.85 // still depressed relative to the pre-break level

const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)

export function detectHealth(byCam) {
  const out = {}
  for (const id of CAM_IDS) {
    const cells = (byCam?.[id] ?? [])
      .filter(c => c.mean != null && (c.coverage ?? 0) > 0.8)
      .sort((a, b) => (a.sk < b.sk ? -1 : 1))

    if (cells.length < MIN_SIDE * 2) { out[id] = { state: 'ok' }; continue }

    const vals = cells.map(c => c.mean)
    const confs = cells.map(c => c.mean_conf)

    // Scan every admissible split; keep the one with the deepest drop.
    let best = null
    for (let t = MIN_SIDE; t <= cells.length - MIN_SIDE; t++) {
      const before = mean(vals.slice(0, t))
      const after = mean(vals.slice(t))
      if (!before) continue
      const ratio = after / before
      if (!best || ratio < best.ratio) best = { t, ratio, before, after }
    }
    if (!best) { out[id] = { state: 'ok' }; continue }

    const bConf = mean(confs.slice(0, best.t).filter(v => v != null))
    const aConf = mean(confs.slice(best.t).filter(v => v != null))
    const confSteady = bConf == null || aConf == null || Math.abs(aConf - bConf) < CONF_TOLERANCE

    // Is it still depressed now, or did it recover?
    const recent = mean(vals.slice(-MIN_SIDE))
    const stillDown = recent / best.before < RECOVERY_RATIO

    if (best.ratio < DROP_RATIO && confSteady && stillDown) {
      const since = cells[best.t].sk
      out[id] = {
        state: 'view',
        ratio: best.ratio,
        since,
        before: best.before,
        after: best.after,
        detail: `Counts fell to ${Math.round(best.ratio * 100)}% of their prior level around ${since}`
          + ` (${best.before.toFixed(2)} → ${best.after.toFixed(2)} vehicles per frame)`
          + (bConf != null && aConf != null
            ? `, while detector confidence held at ${bConf.toFixed(3)} → ${aConf.toFixed(3)}.`
            : '.')
          + ' The frame changed, not the road.',
      }
    } else {
      out[id] = { state: 'ok', ratio: best.ratio }
    }
  }
  return out
}

import { describe, it, expect } from 'vitest'
import { detectHealth } from '../health'

/**
 * Regression: the first version of this detector compared a trailing 21-day
 * window against the 42 days before it. That only sees a break while it is
 * still recent — two months on, the broken level has become its own baseline
 * and the camera reads healthy again. Run against production data it returned
 * "ok" for 3291-E, reproducing the exact blind spot it exists to remove.
 */
const days = (n, mean, conf, offset = 0) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1) + (offset + i) * 86400000)
  return { sk: d.toISOString().slice(0, 10), mean, mean_conf: conf, coverage: 1 }
})

describe('changepoint scan', () => {
  it('still flags a break that happened long ago', () => {
    // 50 days healthy, then 60 days broken — the break is nowhere near the end.
    const byCam = { '3291-E': [...days(50, 2.5, 0.67), ...days(60, 0.49, 0.663, 50)] }
    const r = detectHealth(byCam)['3291-E']
    expect(r.state).toBe('view')
    expect(r.ratio).toBeLessThan(0.3)
    expect(r.since).toBe('2026-02-20')
  })

  it('clears a camera that broke and then recovered', () => {
    const byCam = { '3291-E': [...days(30, 2.5, 0.67), ...days(30, 0.5, 0.67, 30), ...days(30, 2.4, 0.67, 60)] }
    expect(detectHealth(byCam)['3291-E'].state).toBe('ok')
  })

  it('attributes a drop to the model when confidence fell with it', () => {
    const byCam = { '3291-E': [...days(50, 2.5, 0.70), ...days(50, 0.5, 0.40, 50)] }
    expect(detectHealth(byCam)['3291-E'].state).toBe('ok')
  })

  it('ignores gentle seasonal decline', () => {
    const byCam = { '3287-N': [...days(50, 2.5, 0.67), ...days(50, 2.0, 0.67, 50)] }
    expect(detectHealth(byCam)['3287-N'].state).toBe('ok')
  })
})

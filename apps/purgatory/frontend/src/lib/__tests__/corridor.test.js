import { describe, it, expect } from 'vitest'
import { cohortRank, occupancyRate, band, devPhrase, ago } from '../stats'
import { composeHeadline } from '../headline'
import { detectHealth } from '../health'
import { CAMS, CAM_IDS, VOID } from '../cams'

describe('cohortRank', () => {
  it('splits ties instead of counting them as beaten', () => {
    // 8 zeros and 2 ones. A current 0 is typical, not high.
    const samples = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]
    expect(cohortRank(0, samples)).toBe(40)   // was 80 with `<=`
    expect(cohortRank(1, samples)).toBe(90)
  })
  it('refuses below n=8, where the answer would be noise', () => {
    expect(cohortRank(1, [0, 1, 2])).toBeNull()
    expect(cohortRank(1, [])).toBeNull()
  })
})

describe('occupancyRate', () => {
  it('reports the share of frames containing a vehicle', () => {
    expect(occupancyRate([0, 0, 1, 3])).toBe(0.5)
    expect(occupancyRate([0, 0, 0])).toBe(0)
    expect(occupancyRate([])).toBeNull()
  })
})

describe('band', () => {
  it('returns quartiles of the cohort', () => {
    const b = band([0, 1, 2, 3, 4])
    expect(b.p25).toBe(1); expect(b.p50).toBe(2); expect(b.p75).toBe(3)
  })
})

describe('devPhrase', () => {
  it('never prints an ordinal', () => {
    for (const p of [0, 12, 40, 80, 99]) expect(devPhrase(p, 30)).not.toMatch(/\d/)
  })
  it('says why when there is no cohort', () => {
    expect(devPhrase(null, 3)).toContain('too few')
  })
})

describe('composeHeadline', () => {
  const rows = { '952-N': { pct: 40, latestSk: 'x' } }
  it('leads with a degraded camera, naming its place', () => {
    const h = composeHeadline({ summary: { degraded: ['3291-E'], total: 10, reporting: 10 }, rows, daysOfRecord: 111 })
    expect(h.tone).toBe('view')
    expect(h.lede).toContain('US-550B & 9th St')
  })
  it('falls back to the quiet-state sentence only when nothing is notable', () => {
    const h = composeHeadline({ summary: { degraded: [], total: 10, reporting: 10 }, rows, daysOfRecord: 111 })
    expect(h.tone).toBe('typ')
    expect(h.lede).toContain('111 days')
  })
  it('surfaces an unusually busy camera', () => {
    const h = composeHeadline({
      summary: { degraded: [], total: 10, reporting: 10 },
      rows: { '952-N': { pct: 95, latestSk: 'x' } }, daysOfRecord: 111,
    })
    expect(h.tone).toBe('hi')
    expect(h.lede).toContain('Purgatory Blvd')
  })
  it('always produces a sentence', () => {
    for (const s of [{ degraded: [], total: 10, reporting: 0 }, { degraded: ['a', 'b'], total: 10 }]) {
      const h = composeHeadline({ summary: s, rows: {}, daysOfRecord: 111 })
      expect(typeof h.lede).toBe('string')
      expect(h.lede.length).toBeGreaterThan(10)
    }
  })
})

describe('detectHealth', () => {
  // Sequential dates from a fixed epoch — segments must not overlap, or the
  // sort inside detectHealth interleaves baseline and recent.
  const days = (n, mean, conf, offset = 0) => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1) + (offset + i) * 86400000)
    return { sk: d.toISOString().slice(0, 10), mean, mean_conf: conf, coverage: 1 }
  })

  it('flags a sustained drop while detector confidence holds — the 3291-E signature', () => {
    const byCam = { '3291-E': [...days(42, 4.6, 0.67), ...days(21, 1.0, 0.66, 42)] }
    expect(detectHealth(byCam)['3291-E'].state).toBe('view')
  })
  it('does NOT flag a drop that comes with falling confidence — that is the model, not the view', () => {
    const byCam = { '3291-E': [...days(42, 4.6, 0.70), ...days(21, 1.0, 0.40, 42)] }
    expect(detectHealth(byCam)['3291-E'].state).toBe('ok')
  })
  it('does not flag a steady camera', () => {
    const byCam = { '3288-N': [...days(42, 4.5, 0.69), ...days(21, 4.4, 0.69, 42)] }
    expect(detectHealth(byCam)['3288-N'].state).toBe('ok')
  })
  it('stays quiet without enough history to judge', () => {
    expect(detectHealth({ '952-N': days(10, 1, 0.7) })['952-N'].state).toBe('ok')
  })
})

describe('camera registry', () => {
  it('is ordered resort-first by descending milepost', () => {
    expect(CAMS.every((c, i) => i === 0 || CAMS[i - 1].mp >= c.mp)).toBe(true)
    expect(CAMS[0].km).toBe(1)
  })
  it('has ten cameras and names the unmonitored gap', () => {
    expect(CAM_IDS).toHaveLength(10)
    expect(VOID.miles).toBeCloseTo(22.95, 2)
  })
})

describe('ago', () => {
  it('renders compact ages', () => {
    const now = Date.parse('2026-09-08T18:00:00Z')
    expect(ago('2026-09-08T17:54:00Z', now)).toBe('6 min')
    expect(ago('2026-09-08T12:00:00Z', now)).toBe('6 h')
    expect(ago('2026-08-12T02:15:00Z', now)).toBe('27 d')
  })
})

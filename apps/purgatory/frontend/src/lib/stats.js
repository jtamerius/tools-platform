/** Shared statistics for the corridor page. Small integers, often zero. */

/** Mountain-time hour for a UTC ISO sort key. */
export const mtHour = sk =>
  parseInt(new Date(sk).toLocaleString('sv', { timeZone: 'America/Denver' }).slice(11, 13), 10)

export const mtDate = sk =>
  new Date(sk).toLocaleString('sv', { timeZone: 'America/Denver' }).slice(0, 10)

/**
 * Mid-rank percentile of `value` within `samples`.
 *
 * Ties are split. Counting `sample <= value` instead put a zero above every
 * other zero, and on 952-N 86.5% of frames are zero — so an empty road scored
 * ~87th percentile and rendered red. Returns null below n=8, the same floor
 * flagging.py uses; at n=2 the only possible answers are 50 and 100.
 */
export function cohortRank(value, samples) {
  if (!samples || samples.length < 8) return null
  let below = 0, equal = 0
  for (const s of samples) {
    if (s < value) below++
    else if (s === value) equal++
  }
  return Math.round(((below + equal / 2) / samples.length) * 100)
}

/** p25/p50/p75 of a numeric array. */
export function band(values) {
  if (!values || !values.length) return null
  const v = [...values].sort((a, b) => a - b)
  const at = p => {
    const i = (p / 100) * (v.length - 1)
    const lo = Math.floor(i), hi = Math.ceil(i)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)
  }
  return { p25: at(25), p50: at(50), p75: at(75) }
}

/**
 * Share of frames containing at least one vehicle.
 *
 * Reported instead of a mean because vehicle_count is instantaneous in-frame
 * occupancy, and a mean of 0.16 communicates nothing to a reader. "17% of
 * frames had a vehicle in them" is the same fact, legibly.
 */
export const occupancyRate = counts =>
  counts.length ? counts.filter(c => c > 0).length / counts.length : null

/** Evidence weight for a sample size — drives mark saturation, never a hard cutoff. */
export function confidence(n) {
  if (!n) return 0
  if (n >= 20) return 1
  if (n >= 8) return 0.65
  return 0.35
}

export const fmtPct = v => (v == null ? '—' : `${Math.round(v * 100)}%`)

/** Compact relative age, e.g. "6 min", "3 h", "27 d". */
export function ago(iso, now = Date.now()) {
  if (!iso) return null
  const ms = now - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 90) return `${Math.max(0, min)} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

/** Deviation token for a percentile rank. Typical is a non-colour by design. */
export function devToken(pct) {
  if (pct == null) return 'var(--dev-typ)'
  if (pct >= 90) return 'var(--dev-far-hi)'
  if (pct >= 75) return 'var(--dev-hi)'
  if (pct >= 25) return 'var(--dev-typ)'
  if (pct >= 10) return 'var(--dev-lo)'
  return 'var(--dev-far-lo)'
}

/** Phrase for a percentile rank. Never an ordinal below n=100. */
export function devPhrase(pct, n) {
  if (pct == null) return n ? `n=${n}, too few` : 'no cohort'
  if (pct >= 90) return 'well above typical'
  if (pct >= 75) return 'above typical'
  if (pct >= 25) return 'typical'
  if (pct >= 10) return 'below typical'
  return 'well below typical'
}

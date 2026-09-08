import { byId } from './cams'

/**
 * The masthead sentence, computed at render time.
 *
 * It is a claim, not a title — it must be able to be wrong tomorrow, which is
 * what makes it worth reading. Templates are ordered by how notable the fact
 * is; the quiet-state sentence is the fallback, never the default.
 */
export function composeHeadline({ summary, rows, daysOfRecord }) {
  const now = new Date()
  const dayName = now.toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'long' })
  const hour = parseInt(now.toLocaleString('sv', { timeZone: 'America/Denver' }).slice(11, 13), 10)
  const partOfDay = hour < 5 ? 'overnight' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  const degraded = summary?.degraded ?? []
  const dark = Object.entries(rows ?? {}).filter(([, r]) => !r?.latestSk).map(([id]) => id)
  const busy = Object.entries(rows ?? {}).filter(([, r]) => r?.pct != null && r.pct >= 90)
  const quiet = Object.entries(rows ?? {}).filter(([, r]) => r?.pct != null && r.pct <= 10)

  // 1. A camera has stopped seeing the road. The most notable fact available.
  if (degraded.length === 1) {
    const c = byId[degraded[0]]
    return {
      lede: `The camera at ${c?.place ?? degraded[0]} stopped seeing the road in July. `
        + `The other ${(summary?.total ?? 10) - 1} are running about normal for a ${dayName} ${partOfDay}.`,
      tone: 'view',
    }
  }
  if (degraded.length > 1) {
    return {
      lede: `${degraded.length} of ${summary?.total ?? 10} cameras have lost their view since July. `
        + `The rest are running about normal for a ${dayName} ${partOfDay}.`,
      tone: 'view',
    }
  }
  // 2. Something on the road is genuinely unusual.
  if (busy.length >= 3) {
    return { lede: `${busy.length} cameras are seeing well above their usual ${dayName} ${partOfDay} traffic.`, tone: 'hi' }
  }
  if (busy.length) {
    const c = byId[busy[0][0]]
    return { lede: `Traffic at ${c?.place ?? busy[0][0]} is well above a typical ${dayName} ${partOfDay}.`, tone: 'hi' }
  }
  if (quiet.length >= 5) {
    return { lede: `The corridor is unusually quiet for a ${dayName} ${partOfDay}.`, tone: 'lo' }
  }
  // 3. The instrument itself is degraded.
  if (dark.length) {
    return { lede: `${dark.length} of ${summary?.total ?? 10} cameras are not reporting. The rest look normal.`, tone: 'lag' }
  }
  // 4. Nothing notable — say so plainly rather than inventing drama.
  return {
    lede: `US-550 is running about normal for a ${dayName} ${partOfDay}, `
      + `across ${summary?.reporting ?? 0} cameras and ${daysOfRecord ?? 0} days of record.`,
    tone: 'typ',
  }
}

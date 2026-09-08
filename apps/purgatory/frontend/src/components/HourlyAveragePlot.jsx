import { useEffect, useMemo, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'

const Plot = createPlotlyComponent(Plotly)

// Ingest began 2026-05-16, but the shared detector was still churning through
// v1..v5 until 2026-05-20T13:30. Everything from this date on is one model, so
// the series is comparable without cross-detector calibration.
const SERIES_START = '2026-05-20'

const BASE = {
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: { color: '#e5e7eb', size: 11 },
  legend: { bgcolor: 'rgba(26,29,39,0.8)', bordercolor: '#2b2f3d', borderwidth: 1 },
}

const DOW = [
  { label: 'All', val: null },
  { label: 'Mon', val: 0 }, { label: 'Tue', val: 1 }, { label: 'Wed', val: 2 },
  { label: 'Thu', val: 3 }, { label: 'Fri', val: 4 }, { label: 'Sat', val: 5 },
  { label: 'Sun', val: 6 },
]

const BASIS = [{ label: 'Weekly', val: 'week' }, { label: 'Monthly', val: 'month' }]

const HOUR_TICK = h => {
  const ampm = h < 12 ? 'a' : 'p'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${ampm}`
}

const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length
const median = arr => {
  if (!arr.length) return null
  const v = [...arr].sort((a, b) => a - b)
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

// 0=Mon..6=Sun for an MT date string, computed in UTC to avoid tz drift
const dowIndex = date => (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7

// Monday-anchored week key
const weekKey = date => {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const ctrl = active => ({
  padding: '3px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)',
  background: active ? 'var(--accent)' : 'var(--surface-2)',
  color: active ? '#000' : 'var(--text-muted)',
})

/**
 * Average corridor traffic by hour of day, over all history.
 *
 * Reads pre-aggregated cells from /api/series rather than raw records. The
 * previous version fetched every record ever ingested (hours=87600 across ten
 * cameras, ~82 MB) on mount, regardless of the page's window selector.
 *
 * The corridor value at each hour is the MEDIAN of the per-camera means, not
 * their sum: cameras differ ~17x in how much road they see, so a sum is
 * dominated by the busiest few and a camera losing its view reads as a
 * corridor-wide decline.
 */
export default function HourlyAveragePlot({ api, enabledCams }) {
  const [cells, setCells] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dow, setDow] = useState(null)
  const [basis, setBasis] = useState('week')

  const camList = useMemo(
    () => Object.entries(enabledCams).filter(([, on]) => on).map(([id]) => id).sort(),
    [enabledCams]
  )
  const camKey = camList.join(',')

  useEffect(() => {
    let cancelled = false
    if (!camList.length) { setCells([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    api.fetchSeriesChunked({
      scale: 'hour',
      start: SERIES_START,
      end: new Date().toISOString().slice(0, 10),
      cams: camList,
    })
      .then(res => {
        if (cancelled) return
        // Regroup per (date, hour) so each bucket keeps its per-camera means.
        const buckets = new Map()
        for (const [, list] of Object.entries(res.by_cam ?? {})) {
          for (const c of list) {
            if (c.mean == null) continue
            const key = c.sk
            if (!buckets.has(key)) buckets.set(key, { date: c.date, hour: c.hour, means: [] })
            buckets.get(key).means.push(c.mean)
          }
        }
        setCells([...buckets.values()])
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, camKey])

  const { hourAvg, hourN, nPeriods } = useMemo(() => {
    const byPeriod = {}
    const periods = new Set()
    for (const { date, hour, means } of cells) {
      if (dow != null && dowIndex(date) !== dow) continue
      const key = basis === 'week' ? weekKey(date) : date.slice(0, 7)
      if (!byPeriod[key]) byPeriod[key] = Array.from({ length: 24 }, () => [])
      byPeriod[key][hour].push(median(means))
      periods.add(key)
    }
    // Per-period hourly mean, then average across periods so a long month does
    // not outweigh a short one.
    const perHour = Array.from({ length: 24 }, () => [])
    Object.values(byPeriod).forEach(hours => {
      hours.forEach((vals, h) => { if (vals.length) perHour[h].push(mean(vals)) })
    })
    return {
      hourAvg: perHour.map(v => (v.length ? mean(v) : null)),
      hourN: perHour.map(v => v.length),
      nPeriods: periods.size,
    }
  }, [cells, dow, basis])

  const xs = Array.from({ length: 24 }, (_, h) => h)
  const hasData = hourAvg.some(v => v != null)
  const periodWord = basis === 'week' ? 'weeks' : 'months'

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Avg by</span>
          {BASIS.map(b => (
            <button key={b.val} style={ctrl(basis === b.val)} onClick={() => setBasis(b.val)}>
              {b.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Day</span>
          {DOW.map(d => (
            <button key={d.label} style={ctrl(dow === d.val)} onClick={() => setDow(d.val)}>
              {d.label}
            </button>
          ))}
        </div>
        {!loading && hasData && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            median across {camList.length} cameras · {nPeriods} {periodWord} since {SERIES_START}
          </span>
        )}
        {loading && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading aggregate series…</span>}
        {error && <span style={{ fontSize: 12, color: 'var(--red)' }}>Error: {error}</span>}
      </div>

      <Plot
        data={hasData ? [{
          x: xs,
          y: hourAvg,
          customdata: hourN,
          type: 'scatter',
          mode: 'lines+markers',
          line: { color: '#60a5fa', width: 2, shape: 'spline' },
          marker: { size: 5, color: '#60a5fa' },
          connectgaps: true,
          hovertemplate: '%{x}:00 MT<br>median %{y:.2f} vehicles/frame<br>%{customdata} ' + periodWord + '<extra></extra>',
        }] : []}
        layout={{
          ...BASE,
          height: 280,
          margin: { l: 44, r: 16, t: 10, b: 40 },
          xaxis: {
            gridcolor: '#2b2f3d', title: 'Hour of day (MT)',
            tickmode: 'array', tickvals: xs.filter(h => h % 2 === 0),
            ticktext: xs.filter(h => h % 2 === 0).map(HOUR_TICK),
            range: [-0.5, 23.5],
          },
          yaxis: { gridcolor: '#2b2f3d', title: 'median vehicles / frame', rangemode: 'tozero' },
          hovermode: 'x unified',
          annotations: !hasData && !loading ? [{
            text: camList.length ? 'No aggregate cells yet' : 'No cameras selected',
            xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
            showarrow: false, font: { color: '#9ca3af', size: 13 },
          }] : [],
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%' }}
      />
    </div>
  )
}

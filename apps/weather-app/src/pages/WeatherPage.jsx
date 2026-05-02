import { useState, useEffect, useCallback, useRef } from 'react'
import Plot from 'react-plotly.js'

const CDN_BASE = 'https://d326hhew368icp.cloudfront.net'

const MODEL_COLORS = {
  gfs_seamless:  '#1f77b4',
  ecmwf_ifs025:  '#d62728',
  icon_seamless:  '#2ca02c',
  gem_global:    '#9467bd',
  gfs_hrrr:      '#ff7f0e',
}
const FALLBACK_COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf']

const EVENT_PALETTE = [
  'rgba(255,193,7,0.13)', 'rgba(76,175,80,0.13)', 'rgba(33,150,243,0.13)',
  'rgba(233,30,99,0.13)', 'rgba(156,39,176,0.13)',
]
const EVENT_BORDER = [
  'rgba(255,160,0,0.6)', 'rgba(56,142,60,0.6)', 'rgba(25,118,210,0.6)',
  'rgba(194,24,91,0.6)', 'rgba(123,31,162,0.6)',
]

const VAR_META = {
  temperature_2m:        { label: 'Temperature',      unit: '°F',    fmt: '.1f' },
  precipitation:         { label: 'Precipitation',    unit: 'in',    fmt: '.2f' },
  wind_speed_10m:        { label: 'Wind Speed',       unit: 'mph',   fmt: '.1f' },
  snowfall:              { label: 'Snowfall',         unit: 'in/hr', fmt: '.2f' },
  freezing_level_height: { label: 'Freezing Level',  unit: 'ft',    fmt: '.0f' },
  wind_gusts_10m:        { label: 'Wind Gusts',       unit: 'mph',   fmt: '.1f' },
  cape:                  { label: 'CAPE',             unit: 'J/kg',  fmt: '.0f' },
  surface_pressure:      { label: 'Surface Pressure', unit: 'hPa',   fmt: '.1f' },
}

const MAX_RUN_OFFSET = 19  // 10 days back (20 runs)

function currentRunId() {
  const now = new Date()
  const h = now.getUTCHours() >= 12 ? 12 : 0
  return `${now.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}`
}

function runIdAtOffset(offset) {
  let rid = currentRunId()
  for (let i = 0; i < offset; i++) rid = prevRunId(rid)
  return rid
}

function formatRunLabel(rid) {
  const [date, hour] = rid.split('T')
  const [, mm, dd] = date.split('-')
  return `${mm}/${dd} ${hour}Z`
}

function prevRunId(runId) {
  const [datePart, hourPart] = runId.split('T')
  if (parseInt(hourPart, 10) === 12) return `${datePart}T00`
  const prev = new Date(datePart + 'T00:00:00Z')
  prev.setUTCDate(prev.getUTCDate() - 1)
  return `${prev.toISOString().slice(0, 10)}T12`
}

function toMtIso(isoStr) {
  const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const p = {}
  parts.forEach(({ type, value }) => { p[type] = value })
  const hh = p.hour === '24' ? '00' : p.hour
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`
}

function lastValidIdx(seriesList) {
  let last = 0
  for (const s of (seriesList || [])) {
    for (let i = (s || []).length - 1; i >= 0; i--) {
      if (s[i] != null) { if (i + 1 > last) last = i + 1; break }
    }
  }
  return last
}

function cumsum(arr) {
  let s = 0
  return arr.map(v => { s += (v == null ? 0 : +v || 0); return s })
}

function colQuantile(matrix, q) {
  if (!matrix.length) return []
  const n = matrix[0].length
  const out = new Array(n)
  for (let j = 0; j < n; j++) {
    const col = matrix.map(r => r[j]).filter(v => v != null && !isNaN(v)).sort((a, b) => a - b)
    if (!col.length) { out[j] = null; continue }
    const pos = q * (col.length - 1)
    const lo = Math.floor(pos), hi = Math.ceil(pos)
    out[j] = col[lo] + (col[hi] - col[lo]) * (pos - lo)
  }
  return out
}

function buildTraces(forecast, varKey, xRangeStart) {
  const members = forecast.members || {}
  const hourly  = forecast.hourly  || {}
  const meta    = forecast.meta    || {}
  const timeArr = members.time || hourly.time || []
  const models  = (meta.models?.length ? meta.models : meta.ensemble_models) || []
  const varInfo = VAR_META[varKey] || { label: varKey, unit: '', fmt: '.2f' }
  const hover   = `<b>%{fullData.name}</b><br>${varInfo.label}: %{y:${varInfo.fmt}} ${varInfo.unit}<extra></extra>`
  const traces  = []

  models.forEach((model, mIdx) => {
    const color  = MODEL_COLORS[model] || FALLBACK_COLORS[mIdx % FALLBACK_COLORS.length]
    const rgb    = hexToRgb(color)
    const mlabel = model === 'gfs_hrrr' ? 'GFS-HRRR' : model.split('_')[0].toUpperCase()
    const rgba   = `rgba(${rgb},0.18)`

    let series = ((members[varKey] || {})[model] || [])
    if (!series.length) {
      const fb = (hourly[varKey] || {})[model]
      if (fb) series = [fb]
    }
    if (!series.length) return

    const vEnd = lastValidIdx(series) || timeArr.length
    const tArr = timeArr.slice(0, vEnd).map(toMtIso)

    const processed = series.map(s => {
      const vals = s.slice(0, vEnd).map(v => (v == null ? null : +v))
      return varKey === 'precipitation' ? cumsum(vals) : vals
    })

    if (varKey === 'precipitation' && xRangeStart) {
      const normIdx = Math.max(0, tArr.findIndex(t => t >= xRangeStart))
      processed.forEach(s => {
        const offset = s[normIdx] ?? 0
        for (let i = 0; i < s.length; i++) { if (s[i] != null) s[i] -= offset }
      })
    }

    if (processed.length === 1) {
      traces.push({
        type: 'scatter', x: tArr, y: processed[0], mode: 'lines',
        line: { color, width: 1.8, dash: model === 'gfs_hrrr' ? 'solid' : 'dot' },
        name: mlabel, legendgroup: model, hovertemplate: hover,
      })
    } else {
      const qLo = colQuantile(processed, 0.25)
      const q50 = colQuantile(processed, 0.50)
      const qHi = colQuantile(processed, 0.75)
      traces.push({ type: 'scatter', x: tArr, y: qHi, mode: 'lines', line: { width: 0 },
        hoverinfo: 'skip', showlegend: false, legendgroup: `${model}_iqr` })
      traces.push({ type: 'scatter', x: tArr, y: qLo, mode: 'lines', line: { width: 0 },
        fill: 'tonexty', fillcolor: rgba, hoverinfo: 'skip', showlegend: false, legendgroup: `${model}_iqr` })
      traces.push({ type: 'scatter', x: tArr, y: q50, mode: 'lines',
        line: { color, width: 2.5 }, name: mlabel, legendgroup: model, hovertemplate: hover })
    }
  })

  return traces
}

function buildShapesAndAnnotations(forecast) {
  const events  = forecast.events || []
  const hourly  = forecast.hourly || {}
  const times   = forecast.members?.time || hourly.time || []
  const shapes  = []
  const annotations = []

  events.forEach((ev, i) => {
    const x0 = toMtIso(ev.start_time)
    const x1 = toMtIso(ev.end_time)

    shapes.push({
      type: 'rect', xref: 'x', yref: 'y domain', x0, x1, y0: 0, y1: 1,
      fillcolor: EVENT_PALETTE[i % EVENT_PALETTE.length],
      line: { color: EVENT_BORDER[i % EVENT_BORDER.length], width: 1.5, dash: 'dot' },
      layer: 'below',
    })
    annotations.push({
      x: x0, y: 0.97, xref: 'x', yref: 'y domain',
      text: `<b>E${ev.event_index}</b>`,
      showarrow: false,
      font: { size: 16, color: EVENT_BORDER[i % EVENT_BORDER.length].replace('0.6', '1.0') },
      xanchor: 'left', yanchor: 'top',
    })
  })

  if (times.length) {
    const nowMt = toMtIso(new Date().toISOString())
    const t0Mt  = toMtIso(times[0])
    const tNMt  = toMtIso(times[times.length - 1])
    if (nowMt > t0Mt && nowMt < tNMt) {
      shapes.push({
        type: 'line', xref: 'x', yref: 'y domain', x0: nowMt, x1: nowMt, y0: 0, y1: 1,
        line: { color: 'black', width: 1.5, dash: 'dash' },
      })
      annotations.push({
        x: nowMt, y: 0.97, xref: 'x', yref: 'y domain',
        text: '<b>Now</b>', showarrow: false, font: { size: 10, color: 'black' },
        bgcolor: 'rgba(255,255,255,0.7)', yanchor: 'top',
      })
    }
  }

  return { shapes, annotations }
}

function buildTickerTraces(forecast, xRangeStart, xRangeEnd) {
  const members    = forecast.members
  if (!members?.precipitation) return []
  const timeArr    = members.time || []
  const precipData = members.precipitation
  const meta       = forecast.meta || {}
  const ensModels  = meta.ensemble_models?.length ? meta.ensemble_models : Object.keys(precipData)

  const counts = new Array(timeArr.length).fill(0)
  let totalMembers = 0
  ensModels.forEach(model => {
    const seriesList   = precipData[model] || []
    const memberSeries = seriesList.length > 1 ? seriesList.slice(1) : seriesList
    totalMembers += memberSeries.length
    memberSeries.forEach(series => {
      for (let i = 0; i < series.length; i++) {
        if (series[i] != null && series[i] > 0) counts[i]++
      }
    })
  })
  if (totalMembers === 0) return []

  const tArrMt    = timeArr.map(toMtIso)
  const groups    = new Map()
  for (let i = 0; i < tArrMt.length; i++) {
    const t = tArrMt[i]
    if (t < xRangeStart || t > xRangeEnd) continue
    const c = counts[i]
    if (c === 0) continue
    if (!groups.has(c)) groups.set(c, [])
    groups.get(c).push(t)
  }

  const traces = []
  groups.forEach((times, count) => {
    const xs = [], ys = []
    times.forEach(t => { xs.push(t, t, null); ys.push(0, 1, null) })
    traces.push({
      type: 'scatter', mode: 'lines',
      x: xs, y: ys,
      line: { color: '#1976d2', width: 1 + (count / totalMembers) * 5 },
      hoverinfo: 'skip', showlegend: false,
      yaxis: 'y2',
    })
  })
  return traces
}

// ── KDE helpers ───────────────────────────────────────────────────────────────

function scottBandwidth(vals) {
  const n = vals.length
  if (n < 2) return 0.01
  const mean = vals.reduce((a, b) => a + b, 0) / n
  const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)
  return Math.sqrt(variance) * Math.pow(n, -0.2) || 0.01
}

function evalKde(vals, bw, xGrid) {
  const c = 1 / (vals.length * bw * Math.sqrt(2 * Math.PI))
  return xGrid.map(x => {
    const s = vals.reduce((acc, v) => acc + Math.exp(-0.5 * ((x - v) / bw) ** 2), 0)
    return c * s
  })
}

function buildKdeTracesAndLayout(forecast, evIdx = 0) {
  const members    = forecast.members
  const events     = forecast.events || []
  const meta       = forecast.meta || {}
  if (!members || !events.length) return null

  const ev         = events[Math.min(evIdx, events.length - 1)]
  const timeArr    = members.time || []
  const precipData = members.precipitation || {}
  const ensModels  = meta.ensemble_models?.length ? meta.ensemble_models : Object.keys(precipData)

  const startIdx = timeArr.findIndex(t => t >= ev.start_time)
  let endIdx = timeArr.findIndex(t => t > ev.end_time)
  if (endIdx === -1) endIdx = timeArr.length

  const allTotals   = []
  const modelTotals = []

  ensModels.forEach(model => {
    const seriesList   = precipData[model] || []
    const memberSeries = seriesList.length > 1 ? seriesList.slice(1) : seriesList
    const totals = memberSeries.map(series => {
      let sum = 0
      for (let i = startIdx; i < endIdx; i++) {
        const v = series[i]; sum += v == null ? 0 : Math.max(0, +v)
      }
      return sum
    })
    modelTotals.push(totals)
    allTotals.push(...totals)
  })

  if (!allTotals.length) return null

  const span = Math.max(...allTotals) - Math.min(...allTotals)
  const xMin = Math.max(0, Math.min(...allTotals) - Math.max(span * 0.15, 0.02))
  const xMax = Math.max(...allTotals) + Math.max(span * 0.15, 0.02)
  const xGrid = Array.from({ length: 200 }, (_, i) => xMin + (xMax - xMin) * i / 199)

  const traces = []
  ensModels.forEach((model, mIdx) => {
    const color  = MODEL_COLORS[model] || FALLBACK_COLORS[mIdx % FALLBACK_COLORS.length]
    const totals = modelTotals[mIdx]
    if (!totals.length) return
    const bw    = scottBandwidth(totals)
    const yGrid = evalKde(totals, bw, xGrid)
    const mlabel = model === 'gfs_hrrr' ? 'GFS-HRRR' : model.split('_')[0].toUpperCase()
    const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16)
    traces.push({
      type: 'scatter', mode: 'lines',
      x: xGrid, y: yGrid,
      name: `${mlabel} (n\u202f=\u202f${totals.length})`,
      fill: 'tozeroy',
      line: { color, width: 2 },
      fillcolor: `rgba(${r},${g},${b},0.20)`,
      legendgroup: model,
      hovertemplate: `<b>${mlabel}</b><br>Accum: %{x:.2f} in<br>Density: %{y:.3f}<extra></extra>`,
    })
  })

  const layout = {
    showlegend: true,
    legend: { x: 1.02, y: 1, xanchor: 'left', yanchor: 'top' },
    margin: { l: 60, r: 160, t: 80, b: 60 },
    paper_bgcolor: '#f8faff',
    height: 400,
    xaxis: { title: { text: 'Accumulated Precip (in)' }, automargin: true },
    yaxis: { title: { text: 'Density' } },
  }

  return { traces, layout, ev }
}

export default function WeatherPage() {
  const [locations, setLocations]       = useState([])
  const [query, setQuery]               = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedLoc, setSelectedLoc]   = useState(null)
  const [runOffset, setRunOffset]       = useState(0)
  const [forecast, setForecast]         = useState(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(null)
  const [variable, setVariable]         = useState('precipitation')
  const [activeTab, setActiveTab]       = useState('var')
  const [selectedEventIdx, setSelectedEventIdx] = useState(0)
  const wrapRef = useRef(null)

  const fetchForecast = useCallback(async (loc, runId) => {
    const key = `${loc.lat.toFixed(4)}_${loc.lon.toFixed(4)}`
    const res = await fetch(`${CDN_BASE}/forecasts/${key}/${runId}.json`)
    if (res.status === 404) {
      const prev = prevRunId(runId)
      const res2 = await fetch(`${CDN_BASE}/forecasts/${key}/${prev}.json`)
      if (!res2.ok) throw new Error('No forecast available for this location.')
      return res2.json()
    }
    if (!res.ok) throw new Error(`Forecast fetch failed (${res.status})`)
    return res.json()
  }, [])

  function selectLocation(loc, displayName) {
    setQuery(displayName)
    setShowSuggestions(false)
    setSelectedLoc(loc)
    setLoading(true)
    setError(null)
    setForecast(null)
    setSelectedEventIdx(0)
    fetchForecast(loc, runIdAtOffset(runOffset))
      .then(data => { setForecast(data); setLoading(false) })
      .catch(err  => { setError(err.message); setLoading(false) })
  }

  useEffect(() => {
    fetch(`${CDN_BASE}/locations/manifest.json`)
      .then(r => r.json())
      .then(d => {
        const locs = d.locations || []
        setLocations(locs)
        if (locs.length) {
          const first = locs[0]
          selectLocation(first, first.state ? `${first.name}, ${first.state}` : first.name)
        }
      })
      .catch(() => setError('Failed to load locations.'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedLoc) return
    setLoading(true)
    setError(null)
    fetchForecast(selectedLoc, runIdAtOffset(runOffset))
      .then(data => { setForecast(data); setLoading(false) })
      .catch(err  => { setError(err.message); setLoading(false) })
  }, [runOffset]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const matches = query.trim()
    ? locations.filter(l =>
        l.name.toLowerCase().includes(query.toLowerCase()) ||
        (l.state || '').toLowerCase() === query.toLowerCase()
      ).slice(0, 10)
    : []

  const varInfo = VAR_META[variable] || { label: variable, unit: '' }
  const meta     = forecast?.meta || {}
  const lon      = meta.lon || 0
  const lonLabel = lon < 0 ? `${Math.abs(lon).toFixed(4)}°W` : `${lon.toFixed(4)}°E`

  const currentRid  = runIdAtOffset(0)
  const xRangeStart = toMtIso(currentRid + ':00:00Z')
  const xRangeEnd   = (() => {
    const d = new Date(currentRid + ':00:00Z')
    d.setUTCDate(d.getUTCDate() + 10)
    return toMtIso(d.toISOString())
  })()

  const traces       = forecast ? buildTraces(forecast, variable, xRangeStart) : []
  const tickerTraces = forecast ? buildTickerTraces(forecast, xRangeStart, xRangeEnd) : []
  const { shapes, annotations } = forecast
    ? buildShapesAndAnnotations(forecast)
    : { shapes: [], annotations: [] }
  const kdeResult = forecast ? buildKdeTracesAndLayout(forecast, selectedEventIdx) : null
  const kdeEv     = kdeResult?.ev

  return (
    <div style={styles.page}>
      <div style={styles.controls}>
        <div ref={wrapRef} style={styles.locWrap}>
          <label style={styles.label}>Location</label>
          <div style={{ position: 'relative' }}>
            <input
              style={styles.input}
              value={query}
              placeholder="Type a city…"
              autoComplete="off"
              spellCheck={false}
              onChange={e => { setQuery(e.target.value); setShowSuggestions(true) }}
              onFocus={() => setShowSuggestions(true)}
            />
            {showSuggestions && matches.length > 0 && (
              <ul style={styles.suggestions}>
                {matches.map(loc => (
                  <li
                    key={`${loc.lat}_${loc.lon}`}
                    style={styles.suggestion}
                    onMouseDown={() => selectLocation(
                      loc,
                      loc.state ? `${loc.name}, ${loc.state}` : loc.name
                    )}
                  >
                    {loc.name}
                    {loc.state && <span style={styles.stateTag}>{loc.state}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {activeTab === 'kde' && (forecast?.events?.length ?? 0) > 0 && (
          <div style={styles.varWrap}>
            <label style={styles.label}>Event</label>
            <select
              style={styles.select}
              value={selectedEventIdx}
              onChange={e => setSelectedEventIdx(+e.target.value)}
            >
              {(forecast?.events || []).map((ev, i) => (
                <option key={i} value={i}>E{ev.event_index}</option>
              ))}
            </select>
          </div>
        )}
        {activeTab === 'var' && (
          <div style={styles.varWrap}>
            <label style={styles.label}>Variable</label>
            <select style={styles.select} value={variable} onChange={e => setVariable(e.target.value)}>
              <option value="temperature_2m">Temperature (°F)</option>
              <option value="precipitation">Precipitation (in, accum.)</option>
              <option value="wind_speed_10m">Wind Speed (mph)</option>
              <option value="snowfall">Snowfall (in/hr)</option>
              <option value="freezing_level_height">Freezing Level (ft)</option>
              <option value="wind_gusts_10m">Wind Gusts (mph)</option>
              <option value="cape">CAPE (J/kg)</option>
              <option value="surface_pressure">Surface Pressure (hPa)</option>
            </select>
          </div>
        )}

        <div style={styles.runWrap}>
          <label style={styles.label}>
            Forecast run — {runOffset === 0 ? 'current' : formatRunLabel(runIdAtOffset(runOffset))}
          </label>
          <input
            type="range"
            min={0}
            max={MAX_RUN_OFFSET}
            value={MAX_RUN_OFFSET - runOffset}
            onChange={e => setRunOffset(MAX_RUN_OFFSET - +e.target.value)}
            style={styles.slider}
          />
        </div>
      </div>

      <div style={styles.tabBar}>
        <button
          style={activeTab === 'var' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
          onClick={() => setActiveTab('var')}
        >Variable</button>
        <button
          style={activeTab === 'kde' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
          onClick={() => setActiveTab('kde')}
        >Storm KDE</button>
      </div>

      <div style={styles.chartArea}>
        {loading && !forecast && <div style={styles.status}>Loading forecast…</div>}
        {error   && <div style={styles.statusError}>{error}</div>}
        {forecast && activeTab === 'var' && (
          <div style={{ opacity: loading ? 0.45 : 1, transition: 'opacity 0.15s' }}>
          <Plot
            data={[...traces, ...tickerTraces]}
            layout={{
              title: {
                text: `${varInfo.label} — ${meta.lat}°N, ${lonLabel}<br><sub>Run: ${(meta.fetched_at || '').slice(0, 16)} UTC · ${(forecast.events || []).length} event(s)</sub>`,
                font: { size: 15 },
              },
              template: 'plotly_white',
              height: 560,
              hovermode: 'x unified',
              dragmode: 'pan',
              legend: { orientation: 'h', yanchor: 'top', y: -0.15, xanchor: 'center', x: 0.5, font: { size: 11 } },
              xaxis: { range: [xRangeStart, xRangeEnd], tickformat: '%a\n%b %d', gridcolor: 'rgba(200,200,200,0.4)' },
              yaxis: { title: { text: `${varInfo.label} (${varInfo.unit})` }, gridcolor: 'rgba(200,200,200,0.4)', domain: [0.13, 1] },
              yaxis2: { domain: [0, 0.08], showticklabels: false, showgrid: false, zeroline: false, fixedrange: true, range: [0, 1] },
              margin: { t: 80, b: 80 },
              shapes,
              annotations,
            }}
            config={{ scrollZoom: false, displayModeBar: 'hover', responsive: true }}
            style={{ width: '100%' }}
            useResizeHandler
          />
          </div>
        )}
        {forecast && activeTab === 'kde' && (
          kdeResult
            ? <Plot
                data={kdeResult.traces}
                layout={{
                  ...kdeResult.layout,
                  title: {
                    text: `Storm KDE — E${kdeEv?.event_index}: ${(kdeEv?.start_time || '').slice(5,10)}–${(kdeEv?.end_time || '').slice(5,10)} (${kdeEv?.duration_hours}h)<br><sub>${meta.lat}°N, ${lonLabel} · Run: ${(meta.fetched_at || '').slice(0, 16)} UTC</sub>`,
                    font: { size: 15 },
                  },
                  template: 'plotly_white',
                }}
                config={{ scrollZoom: false, displayModeBar: 'hover', responsive: true }}
                style={{ width: '100%' }}
                useResizeHandler
              />
            : <div style={styles.status}>No ensemble data available for Storm KDE.</div>
        )}
      </div>
    </div>
  )
}

const styles = {
  page: {
    display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--nav-height))',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    background: 'var(--bg)',
  },
  controls: {
    display: 'flex', alignItems: 'flex-end', gap: 16, padding: '10px 16px',
    background: 'var(--bg-subtle, #f8f9fa)', borderBottom: '1px solid var(--border-subtle, #dee2e6)',
    flexWrap: 'wrap',
  },
  locWrap:  { display: 'flex', flexDirection: 'column', gap: 4 },
  varWrap:  { display: 'flex', flexDirection: 'column', gap: 4 },
  label:    { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #555)' },
  input: {
    fontSize: 14, padding: '5px 10px', border: '1px solid var(--border, #ced4da)',
    borderRadius: 6, background: 'white', minWidth: 220, outline: 'none',
  },
  select: {
    fontSize: 13, padding: '5px 10px', border: '1px solid var(--border, #ced4da)',
    borderRadius: 5, background: 'white', cursor: 'pointer', color: '#333', minWidth: 220,
  },
  suggestions: {
    position: 'absolute', top: '100%', left: 0, minWidth: '100%',
    background: 'white', border: '1px solid var(--border, #ced4da)',
    borderTop: 'none', borderRadius: '0 0 6px 6px', listStyle: 'none',
    maxHeight: 240, overflowY: 'auto', zIndex: 1000,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', margin: 0, padding: 0,
  },
  suggestion: {
    padding: '6px 12px', cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  stateTag:    { fontSize: 11, color: '#888', marginLeft: 12 },
  runWrap: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 },
  slider:  { width: '100%', cursor: 'pointer', accentColor: '#1976d2' },
  tabBar: {
    display: 'flex', borderBottom: '1px solid var(--border-subtle, #dee2e6)',
    background: 'var(--bg-subtle, #f8f9fa)', padding: '0 16px',
  },
  tab: {
    padding: '7px 18px', border: 'none', borderBottom: '2px solid transparent',
    background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 500,
    color: 'var(--text-secondary, #666)',
  },
  tabActive: {
    borderBottom: '2px solid #1976d2',
    color: '#1976d2',
  },
  chartArea:       { flex: 1, overflow: 'hidden', padding: '8px 8px 0' },
  chartAreaScroll: { flex: 1, overflowY: 'auto', padding: '8px 8px 0' },
  status:      { textAlign: 'center', padding: 40, color: '#666', fontSize: 14 },
  statusError: { textAlign: 'center', padding: 40, color: '#c00', fontSize: 14 },
}

import { useMemo, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'
import { toMT } from './MultiCamPlot'

const Plot = createPlotlyComponent(Plotly)

const MA_OPTIONS = [null, 1, 3, 6]

const BASE = {
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: { color: '#e5e7eb', size: 11 },
  legend: { bgcolor: 'rgba(26,29,39,0.8)', bordercolor: '#2b2f3d', borderwidth: 1, itemclick: 'toggle', itemdoubleclick: 'toggleothers' },
}

function trailingMA(sorted, windowMs) {
  return sorted.map(([sk], i) => {
    const t = new Date(sk).getTime()
    let sum = 0, count = 0
    for (let j = i; j >= 0; j--) {
      if (t - new Date(sorted[j][0]).getTime() > windowMs) break
      sum += sorted[j][1]
      count++
    }
    return count ? sum / count : null
  })
}

const mtHour = sk => {
  const s = new Date(sk).toLocaleString('sv', { timeZone: 'America/Denver' })
  return new Date(s).getHours()
}

const hourLabel = h => h === 0 ? '12am' : h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`

export default function AggregatePlot({ histories, hours, enabledCams }) {
  const [maHours, setMaHours] = useState(null)
  const [showHourly, setShowHourly] = useState(false)

  const now = new Date()
  const xEnd = toMT(now.toISOString())
  const xStart = toMT(new Date(now - hours * 3600 * 1000).toISOString())

  const { totalSorted, inboundSorted, outboundSorted, hourlyAvg, anyEnabled, hasZones } = useMemo(() => {
    const byTs = {}
    let anyEnabled = false

    Object.entries(enabledCams).forEach(([camId, enabled]) => {
      if (!enabled) return
      anyEnabled = true
      ;(histories[camId] ?? []).forEach(r => {
        if (!byTs[r.sk]) byTs[r.sk] = { total: 0, inbound: 0, outbound: 0, hasZones: false }
        byTs[r.sk].total += r.vehicle_count ?? 0
        if (r.vehicle_counts_by_zone && Object.keys(r.vehicle_counts_by_zone).length) {
          byTs[r.sk].inbound += Number(r.vehicle_counts_by_zone.Inbound ?? 0)
          byTs[r.sk].outbound += Number(r.vehicle_counts_by_zone.Outbound ?? 0)
          byTs[r.sk].hasZones = true
        }
      })
    })

    const sorted = Object.entries(byTs).sort(([a], [b]) => a < b ? -1 : 1)
    const totalSorted = sorted.map(([sk, v]) => [sk, v.total])
    const inboundSorted = sorted.map(([sk, v]) => [sk, v.inbound])
    const outboundSorted = sorted.map(([sk, v]) => [sk, v.outbound])
    const hasZones = sorted.some(([, v]) => v.hasZones)

    // Hourly averages (MT)
    const buckets = Array.from({ length: 24 }, () => ({ total: [], inbound: [], outbound: [] }))
    sorted.forEach(([sk, v]) => {
      const h = mtHour(sk)
      buckets[h].total.push(v.total)
      if (v.hasZones) {
        buckets[h].inbound.push(v.inbound)
        buckets[h].outbound.push(v.outbound)
      }
    })
    const avg = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null
    const hourlyAvg = buckets.map((b, h) => ({ h, total: avg(b.total), inbound: avg(b.inbound), outbound: avg(b.outbound) }))

    return { totalSorted, inboundSorted, outboundSorted, hourlyAvg, anyEnabled, hasZones }
  }, [enabledCams, histories])

  const xs = totalSorted.map(([sk]) => toMT(sk))

  const traces = []
  if (totalSorted.length) {
    traces.push({ name: 'Total', x: xs, y: totalSorted.map(([, v]) => v), type: 'scatter', mode: 'lines+markers', marker: { size: 3, color: '#60a5fa' }, line: { color: '#60a5fa', width: 1.5 } })
    if (maHours) traces.push({ name: `Total ${maHours}h MA`, x: xs, y: trailingMA(totalSorted, maHours * 3600e3), type: 'scatter', mode: 'lines', line: { color: '#60a5fa', width: 2, dash: 'dot' }, showlegend: true })
  }
  if (hasZones) {
    const xi = inboundSorted.map(([sk]) => toMT(sk))
    const xo = outboundSorted.map(([sk]) => toMT(sk))
    traces.push({ name: 'Inbound', x: xi, y: inboundSorted.map(([, v]) => v), type: 'scatter', mode: 'lines+markers', marker: { size: 3, color: '#34d399' }, line: { color: '#34d399', width: 1.5 } })
    if (maHours) traces.push({ name: `Inbound ${maHours}h MA`, x: xi, y: trailingMA(inboundSorted, maHours * 3600e3), type: 'scatter', mode: 'lines', line: { color: '#34d399', width: 2, dash: 'dot' } })
    traces.push({ name: 'Outbound', x: xo, y: outboundSorted.map(([, v]) => v), type: 'scatter', mode: 'lines+markers', marker: { size: 3, color: '#f59e0b' }, line: { color: '#f59e0b', width: 1.5 } })
    if (maHours) traces.push({ name: `Outbound ${maHours}h MA`, x: xo, y: trailingMA(outboundSorted, maHours * 3600e3), type: 'scatter', mode: 'lines', line: { color: '#f59e0b', width: 2, dash: 'dot' } })
  }

  const hlabels = hourlyAvg.map(({ h }) => hourLabel(h))
  const hourlyTraces = showHourly ? [
    { name: 'Total avg', x: hlabels, y: hourlyAvg.map(b => b.total), type: 'bar', marker: { color: 'rgba(96,165,250,0.6)' } },
    ...(hasZones ? [
      { name: 'Inbound avg', x: hlabels, y: hourlyAvg.map(b => b.inbound), type: 'bar', marker: { color: 'rgba(52,211,153,0.6)' } },
      { name: 'Outbound avg', x: hlabels, y: hourlyAvg.map(b => b.outbound), type: 'bar', marker: { color: 'rgba(245,158,11,0.6)' } },
    ] : []),
  ] : []

  const ctrl = (active) => ({
    padding: '3px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
    border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'var(--surface-2)',
    color: active ? '#000' : 'var(--text-muted)',
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>MA</span>
          {MA_OPTIONS.map(h => (
            <button key={h ?? 'off'} style={ctrl(maHours === h)} onClick={() => setMaHours(h)}>
              {h == null ? 'Off' : `${h}h`}
            </button>
          ))}
        </div>
        <button style={ctrl(showHourly)} onClick={() => setShowHourly(v => !v)}>Hourly avg</button>
      </div>

      <Plot
        data={anyEnabled ? traces : []}
        layout={{
          ...BASE,
          height: 260,
          margin: { l: 44, r: 16, t: 10, b: 40 },
          xaxis: { gridcolor: '#2b2f3d', tickangle: -30, title: 'MT', range: [xStart, xEnd] },
          yaxis: { gridcolor: '#2b2f3d', title: 'vehicles', rangemode: 'tozero' },
          hovermode: 'x unified',
          annotations: !anyEnabled ? [{ text: 'Select cameras above', xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, font: { color: '#9ca3af', size: 13 } }] : [],
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%' }}
      />

      {showHourly && (
        <Plot
          data={hourlyTraces}
          layout={{
            ...BASE,
            height: 200,
            margin: { l: 44, r: 16, t: 24, b: 40 },
            barmode: 'group',
            title: { text: 'Average by hour of day (MT)', font: { size: 12, color: '#9ca3af' }, x: 0.5 },
            xaxis: { gridcolor: '#2b2f3d' },
            yaxis: { gridcolor: '#2b2f3d', title: 'avg vehicles', rangemode: 'tozero' },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />
      )}
    </div>
  )
}

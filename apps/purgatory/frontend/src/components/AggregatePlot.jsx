import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'
import { toMT } from './MultiCamPlot'

const Plot = createPlotlyComponent(Plotly)

export default function AggregatePlot({ histories, hours, selectedCamIds }) {
  const now = new Date()
  const xEnd = toMT(now.toISOString())
  const xStart = toMT(new Date(now - hours * 3600 * 1000).toISOString())

  const byTimestamp = {}
  selectedCamIds.forEach(id => {
    ;(histories[id] ?? []).forEach(r => {
      if (!byTimestamp[r.sk]) byTimestamp[r.sk] = 0
      byTimestamp[r.sk] += r.vehicle_count ?? 0
    })
  })
  const sorted = Object.entries(byTimestamp).sort(([a], [b]) => a < b ? -1 : 1)

  const trace = {
    name: 'Total',
    x: sorted.map(([sk]) => toMT(sk)),
    y: sorted.map(([, v]) => v),
    type: 'scatter',
    mode: 'lines+markers',
    marker: { size: 4, color: '#60a5fa' },
    line: { color: '#60a5fa', width: 2 },
    fill: 'tozeroy',
    fillcolor: 'rgba(96,165,250,0.08)',
  }

  const noSelection = selectedCamIds.length === 0

  return (
    <Plot
      data={noSelection ? [] : [trace]}
      layout={{
        height: 260,
        margin: { l: 44, r: 16, t: 10, b: 40 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e5e7eb', size: 11 },
        xaxis: { gridcolor: '#2b2f3d', tickangle: -30, title: 'MT', range: [xStart, xEnd] },
        yaxis: { gridcolor: '#2b2f3d', title: 'vehicles', rangemode: 'tozero' },
        hovermode: 'x unified',
        annotations: noSelection ? [{
          text: 'Select cameras above',
          xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
          showarrow: false, font: { color: '#9ca3af', size: 13 },
        }] : [],
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: '100%' }}
    />
  )
}

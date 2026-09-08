import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'
import { toMT } from '../lib/time'
const Plot = createPlotlyComponent(Plotly)

export default function TrafficPlot({ history, highlightSk }) {
  if (!history.length) return <div style={{ color: 'var(--text-muted)', padding: 8 }}>No history</div>

  const xs = history.map(h => toMT(h.sk))
  const ys = history.map(h => h.vehicle_count ?? 0)
  const highlightX = highlightSk ? toMT(highlightSk) : null
  const highlight = highlightX ? xs.indexOf(highlightX) : -1

  return (
    <Plot
      data={[
        {
          x: xs,
          y: ys,
          type: 'scatter',
          mode: 'lines+markers',
          marker: { size: 5, color: '#60a5fa' },
          line: { color: '#60a5fa' },
        },
        highlight >= 0 ? {
          x: [xs[highlight]],
          y: [ys[highlight]],
          type: 'scatter',
          mode: 'markers',
          marker: { size: 12, color: '#f59e0b', line: { color: '#fff', width: 2 } },
          showlegend: false,
        } : null,
      ].filter(Boolean)}
      layout={{
        height: 220,
        margin: { l: 40, r: 10, t: 10, b: 30 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e5e7eb', size: 11 },
        xaxis: { gridcolor: '#2b2f3d' },
        yaxis: { gridcolor: '#2b2f3d', title: 'vehicles' },
        showlegend: false,
      }}
      config={{ displayModeBar: false }}
      style={{ width: '100%' }}
    />
  )
}

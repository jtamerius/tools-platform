import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'
const Plot = createPlotlyComponent(Plotly)

// Convert UTC ISO string to a tz-naive string in America/Denver so Plotly renders MT labels.
// Uses 'sv' locale which produces "YYYY-MM-DD HH:MM:SS" — Plotly reads it as a local datetime.
export const toMT = (utcStr) =>
  new Date(utcStr).toLocaleString('sv', { timeZone: 'America/Denver' }).replace(' ', 'T')

export const CAM_COLORS = {
  '952-N':  '#60a5fa',
  '952-S':  '#818cf8',
  '957-N':  '#34d399',
  '957-S':  '#86efac',
  '1053-N': '#f59e0b',
  '3285-N': '#f472b6',
  '3287-N': '#fb923c',
  '3288-N': '#a78bfa',
  '3289-S': '#22d3ee',
  '3291-E': '#e879f9',
}

const CAMS = ['952-N', '952-S', '957-N', '957-S', '1053-N', '3285-N', '3287-N', '3288-N', '3289-S', '3291-E']

export default function MultiCamPlot({ histories, hours }) {
  const now = new Date()
  const xEnd = toMT(now.toISOString())
  const xStart = toMT(new Date(now - hours * 3600 * 1000).toISOString())

  const traces = CAMS.map(id => {
    const recs = (histories[id] ?? []).slice().sort((a, b) => a.sk < b.sk ? -1 : 1)
    return {
      name: id,
      x: recs.map(r => toMT(r.sk)),
      y: recs.map(r => r.vehicle_count ?? 0),
      type: 'scatter',
      mode: 'lines+markers',
      marker: { size: 4, color: CAM_COLORS[id] },
      line: { color: CAM_COLORS[id] },
    }
  })

  return (
    <Plot
      data={traces}
      layout={{
        height: 340,
        margin: { l: 44, r: 16, t: 10, b: 40 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e5e7eb', size: 11 },
        xaxis: { gridcolor: '#2b2f3d', tickangle: -30, title: 'MT', range: [xStart, xEnd] },
        yaxis: { gridcolor: '#2b2f3d', title: 'vehicles', rangemode: 'tozero' },
        legend: {
          bgcolor: 'rgba(26,29,39,0.8)',
          bordercolor: '#2b2f3d',
          borderwidth: 1,
          itemclick: 'toggle',
          itemdoubleclick: 'toggleothers',
        },
        hovermode: 'x unified',
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: '100%' }}
    />
  )
}

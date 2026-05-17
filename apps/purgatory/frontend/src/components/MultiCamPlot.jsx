import Plot from 'react-plotly.js'

export const CAM_COLORS = {
  '952-N':  '#60a5fa',
  '952-S':  '#818cf8',
  '957-N':  '#34d399',
  '1053-N': '#f59e0b',
}

const CAMS = ['952-N', '952-S', '957-N', '1053-N']

export default function MultiCamPlot({ histories }) {
  const traces = CAMS.map(id => {
    const recs = (histories[id] ?? []).slice().sort((a, b) => a.sk < b.sk ? -1 : 1)
    return {
      name: id,
      x: recs.map(r => r.sk),
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
        xaxis: { gridcolor: '#2b2f3d', tickangle: -30 },
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

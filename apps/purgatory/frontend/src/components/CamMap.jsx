import { useEffect, useRef } from 'react'
import { CAM_COLORS } from './MultiCamPlot'

// markerColor(percentile) → fill color for the marker
// percentile is 0-100 or null (no data)
function markerColor(pct, defaultColor) {
  if (pct == null) return defaultColor
  if (pct >= 75) return '#ef4444'   // red — high traffic
  if (pct >= 50) return '#f59e0b'   // amber — above avg
  if (pct >= 25) return '#34d399'   // green — below avg
  return '#60a5fa'                   // accent — low traffic
}

const ALL_CAMS = [
  { id: '952-N',    lat: 37.62193,  lon: -107.8119,  mp: 48.6,  driveMin: 2,  type: 'traffic' },
  { id: '952-S',    lat: 37.62193,  lon: -107.8119,  mp: 48.6,  driveMin: 2,  type: 'traffic' },
  { id: '957-N',    lat: 37.32353,  lon: -107.85171, mp: 25.65, driveMin: 23, type: 'traffic' },
  { id: '957-S',    lat: 37.32353,  lon: -107.85171, mp: 25.65, driveMin: 23, type: 'traffic' },
  { id: '1053-N',   lat: 37.22151,  lon: -107.84669, mp: 16.25, driveMin: 33, type: 'traffic' },
  { id: '3285-N',   lat: 37.30661,  lon: -107.86523, mp: 24.15, driveMin: 35, type: 'traffic' },
  { id: '3287-N',   lat: 37.28976,  lon: -107.87508, mp: 22.60, driveMin: 37, type: 'traffic' },
  { id: '3288-N',   lat: 37.28738,  lon: -107.87594, mp: 22.40, driveMin: 37, type: 'traffic' },
  { id: '3289-S',   lat: 37.28226,  lon: -107.87801, mp: 22.05, driveMin: 38, type: 'traffic' },
  { id: '3291-E',   lat: 37.27392,  lon: -107.88357, mp: 21.30, driveMin: 40, type: 'traffic' },
  { id: '954-RWIS', lat: 37.26881,  lon: -107.88429, mp: 20.95, driveMin: 28, type: 'rwis' },
]

export default function CamMap({ onCamClick, camPercentiles }) {
  const containerRef = useRef(null)
  const onClickRef = useRef(onCamClick)
  const markersRef = useRef({})

  useEffect(() => { onClickRef.current = onCamClick }, [onCamClick])

  // Update marker colors when percentiles change without rebuilding the map
  useEffect(() => {
    if (!camPercentiles) return
    ALL_CAMS.forEach(cam => {
      if (cam.type === 'rwis') return
      const m = markersRef.current[cam.id]
      if (!m) return
      const defaultColor = CAM_COLORS[cam.id] ?? '#9ca3af'
      const fill = markerColor(camPercentiles[cam.id], defaultColor)
      m.setStyle({ fillColor: fill })
    })
  }, [camPercentiles])

  useEffect(() => {
    let map
    let cancelled = false

    Promise.all([
      import('leaflet'),
      import('leaflet/dist/leaflet.css'),
    ]).then(([leafletModule]) => {
      if (cancelled) return
      const L = leafletModule.default

      map = L.map(containerRef.current, { zoomControl: true }).setView([37.42, -107.83], 10)

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map)

      ALL_CAMS.forEach(cam => {
        const defaultColor = CAM_COLORS[cam.id] ?? '#9ca3af'
        const fill = markerColor(null, defaultColor)
        const radius = cam.type === 'rwis' ? 6 : 11

        const marker = L.circleMarker([cam.lat, cam.lon], {
          radius,
          color: cam.type === 'traffic' ? '#0f1117' : '#555',
          weight: cam.type === 'traffic' ? 2 : 1,
          fillColor: fill,
          fillOpacity: cam.type === 'traffic' ? 0.95 : 0.6,
        }).addTo(map)

        if (cam.type === 'traffic') {
          markersRef.current[cam.id] = marker
          marker.getElement && (marker.getElement().style.cursor = 'pointer')
          marker.on('click', () => onClickRef.current?.(cam.id))
        }

        const typeLabel = cam.type === 'rwis'
          ? 'RWIS weather station'
          : `Traffic cam · ${cam.driveMin} min to resort`

        marker.bindPopup(
          `<b style="color:#111">${cam.id}</b><br>MP ${cam.mp} · US-550<br>` +
          `<span style="color:#555;font-size:12px">${typeLabel}</span>` +
          (cam.type === 'traffic' ? '<br><span style="color:#888;font-size:11px">Click to view snapshots</span>' : ''),
          { maxWidth: 180 }
        )

        if (cam.type === 'traffic') {
          const icon = L.divIcon({
            className: '',
            html: `<span style="background:${fill};color:#000;font-size:10px;font-weight:700;` +
                  `padding:2px 5px;border-radius:3px;white-space:nowrap;` +
                  `border:1px solid rgba(0,0,0,0.4);box-shadow:0 1px 3px rgba(0,0,0,0.5)">${cam.id}</span>`,
            iconAnchor: [-13, 8],
          })
          L.marker([cam.lat, cam.lon], { icon, interactive: false }).addTo(map)
        }
      })
    })

    return () => {
      cancelled = true
      markersRef.current = {}
      if (map) map.remove()
    }
  }, [])

  return <div ref={containerRef} style={{ height: 340, borderRadius: 6, overflow: 'hidden' }} />
}

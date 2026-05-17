import { useEffect, useRef } from 'react'
import { CAM_COLORS } from './MultiCamPlot'

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

export default function CamMap() {
  const containerRef = useRef(null)

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

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map)

      ALL_CAMS.forEach(cam => {
        const color = CAM_COLORS[cam.id] ?? '#9ca3af'
        const radius = cam.type === 'rwis' ? 7 : 10

        const marker = L.circleMarker([cam.lat, cam.lon], {
          radius,
          color: '#0f1117',
          weight: 2,
          fillColor: color,
          fillOpacity: 0.9,
        }).addTo(map)

        const typeLabel = cam.type === 'rwis'
          ? 'Weather station'
          : `Traffic cam · ${cam.driveMin} min to resort`

        marker.bindPopup(
          `<b style="color:#000">${cam.id}</b><br>MP ${cam.mp} · US-550<br>` +
          `<span style="color:#555">${typeLabel}</span>`
        )

        const icon = L.divIcon({
          className: '',
          html: `<span style="background:${color};color:#000;font-size:10px;font-weight:600;` +
                `padding:1px 4px;border-radius:3px;white-space:nowrap;` +
                `border:1px solid #0f1117">${cam.id}</span>`,
          iconAnchor: [-12, 8],
        })
        L.marker([cam.lat, cam.lon], { icon, interactive: false }).addTo(map)
      })
    })

    return () => {
      cancelled = true
      if (map) map.remove()
    }
  }, [])

  return <div ref={containerRef} style={{ height: 340, borderRadius: 6, overflow: 'hidden' }} />
}

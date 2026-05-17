import { useEffect, useRef, useState, useCallback } from 'react'

const ZONE_COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#818cf8', '#f87171', '#fb923c']
const HIT_RADIUS = 10

function ptInPoly(poly, px, py) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1]
    const xj = poly[j][0], yj = poly[j][1]
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi))
      inside = !inside
  }
  return inside
}

function dist(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
}

export default function ZoneEditor({ imageUrl, zones = [], onChange }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const [drawing, setDrawing] = useState(false)
  const [currentPts, setCurrentPts] = useState([])
  const [selected, setSelected] = useState(null) // index of selected zone
  const [newZoneName, setNewZoneName] = useState('')
  const [addingZone, setAddingZone] = useState(false)
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 })
  const [imgDisplayRect, setImgDisplayRect] = useState({ x: 0, y: 0, w: 1, h: 1 })

  // Canvas-to-image coordinate transform
  const toImage = useCallback((cx, cy) => {
    const { x, y, w, h } = imgDisplayRect
    return [
      Math.round(((cx - x) / w) * imgNatural.w),
      Math.round(((cy - y) / h) * imgNatural.h),
    ]
  }, [imgDisplayRect, imgNatural])

  const toCanvas = useCallback((ix, iy) => {
    const { x, y, w, h } = imgDisplayRect
    return [
      x + (ix / imgNatural.w) * w,
      y + (iy / imgNatural.h) * h,
    ]
  }, [imgDisplayRect, imgNatural])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw image
    const { x, y, w, h } = imgDisplayRect
    ctx.drawImage(img, x, y, w, h)

    // Draw committed zones
    zones.forEach((zone, zi) => {
      const poly = (zone.polygon || []).map(([ix, iy]) => toCanvas(ix, iy))
      if (poly.length < 2) return
      const color = zone.color || ZONE_COLORS[zi % ZONE_COLORS.length]
      const isSelected = zi === selected

      ctx.beginPath()
      ctx.moveTo(poly[0][0], poly[0][1])
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
      ctx.closePath()
      ctx.fillStyle = color + '33' // 20% opacity
      ctx.fill()
      ctx.strokeStyle = isSelected ? '#fff' : color
      ctx.lineWidth = isSelected ? 2 : 1.5
      ctx.stroke()

      // Vertices
      poly.forEach(([cx, cy]) => {
        ctx.beginPath()
        ctx.arc(cx, cy, 5, 0, Math.PI * 2)
        ctx.fillStyle = isSelected ? '#fff' : color
        ctx.fill()
      })

      // Label
      if (poly.length >= 3) {
        const centX = poly.reduce((s, p) => s + p[0], 0) / poly.length
        const centY = poly.reduce((s, p) => s + p[1], 0) / poly.length
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 12px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = '#000'
        ctx.shadowBlur = 4
        ctx.fillText(zone.name || `Zone ${zi + 1}`, centX, centY)
        ctx.shadowBlur = 0
      }
    })

    // Draw in-progress polygon
    if (drawing && currentPts.length > 0) {
      const poly = currentPts.map(([ix, iy]) => toCanvas(ix, iy))
      const color = ZONE_COLORS[zones.length % ZONE_COLORS.length]
      ctx.beginPath()
      ctx.moveTo(poly[0][0], poly[0][1])
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      ctx.stroke()
      ctx.setLineDash([])
      poly.forEach(([cx, cy]) => {
        ctx.beginPath()
        ctx.arc(cx, cy, 5, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
      })
    }
  }, [zones, selected, drawing, currentPts, imgDisplayRect, toCanvas])

  useEffect(() => {
    draw()
  }, [draw])

  const updateDisplayRect = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete) return
    const cw = canvas.width, ch = canvas.height
    const iw = img.naturalWidth, ih = img.naturalHeight
    setImgNatural({ w: iw, h: ih })
    const scale = Math.min(cw / iw, ch / ih)
    const w = iw * scale, h = ih * scale
    setImgDisplayRect({ x: (cw - w) / 2, y: (ch - h) / 2, w, h })
  }, [])

  const handleImageLoad = useCallback(() => {
    updateDisplayRect()
  }, [updateDisplayRect])

  const handleCanvasClick = useCallback((e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const cx = (e.clientX - rect.left) * scaleX
    const cy = (e.clientY - rect.top) * scaleY

    if (drawing) {
      const pt = toImage(cx, cy)
      // Close polygon on click near first point
      if (currentPts.length >= 3) {
        const [fcx, fcy] = toCanvas(...currentPts[0])
        if (dist(cx, cy, fcx, fcy) < HIT_RADIUS) {
          const color = ZONE_COLORS[zones.length % ZONE_COLORS.length]
          onChange([...zones, { name: newZoneName || `Zone ${zones.length + 1}`, polygon: currentPts, color }])
          setCurrentPts([])
          setDrawing(false)
          setAddingZone(false)
          setNewZoneName('')
          return
        }
      }
      setCurrentPts(prev => [...prev, pt])
      return
    }

    // Click to select a zone
    const imgPt = toImage(cx, cy)
    for (let i = zones.length - 1; i >= 0; i--) {
      if (ptInPoly(zones[i].polygon || [], imgPt[0], imgPt[1])) {
        setSelected(i === selected ? null : i)
        return
      }
    }
    setSelected(null)
  }, [drawing, currentPts, zones, selected, toImage, toCanvas, newZoneName, onChange])

  const handleDblClick = useCallback((e) => {
    if (!drawing || currentPts.length < 3) return
    e.preventDefault()
    const color = ZONE_COLORS[zones.length % ZONE_COLORS.length]
    onChange([...zones, { name: newZoneName || `Zone ${zones.length + 1}`, polygon: currentPts, color }])
    setCurrentPts([])
    setDrawing(false)
    setAddingZone(false)
    setNewZoneName('')
  }, [drawing, currentPts, zones, newZoneName, onChange])

  const startAddZone = () => {
    setAddingZone(true)
    setSelected(null)
  }

  const confirmAddZone = () => {
    setDrawing(true)
    setCurrentPts([])
  }

  const deleteSelected = () => {
    if (selected == null) return
    onChange(zones.filter((_, i) => i !== selected))
    setSelected(null)
  }

  const cancelDrawing = () => {
    setDrawing(false)
    setCurrentPts([])
    setAddingZone(false)
    setNewZoneName('')
  }

  const s = {
    wrap: { position: 'relative' },
    canvas: { display: 'block', width: '100%', cursor: drawing ? 'crosshair' : 'pointer', borderRadius: 4, background: '#0f1117' },
    toolbar: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' },
    btn: (variant) => ({
      padding: '4px 12px',
      borderRadius: 4,
      border: '1px solid var(--border)',
      background: variant === 'danger' ? '#7f1d1d' : variant === 'primary' ? 'var(--accent)' : 'var(--surface)',
      color: variant === 'primary' ? '#000' : 'var(--text)',
      fontSize: 13,
      cursor: 'pointer',
    }),
    input: { padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 },
    hint: { fontSize: 12, color: 'var(--text-muted)' },
    zoneList: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 },
    zoneTag: (zi, isSelected) => ({
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 12,
      background: (zones[zi]?.color || ZONE_COLORS[zi % ZONE_COLORS.length]) + '33',
      border: `1px solid ${zones[zi]?.color || ZONE_COLORS[zi % ZONE_COLORS.length]}`,
      color: 'var(--text)',
      cursor: 'pointer',
      fontWeight: isSelected ? 700 : 400,
    }),
  }

  return (
    <div style={s.wrap}>
      <img
        ref={imgRef}
        src={imageUrl}
        onLoad={handleImageLoad}
        style={{ display: 'none' }}
        alt=""
      />
      <canvas
        ref={canvasRef}
        width={960}
        height={540}
        style={s.canvas}
        onClick={handleCanvasClick}
        onDoubleClick={handleDblClick}
      />
      <div style={s.zoneList}>
        {zones.map((z, i) => (
          <span key={i} style={s.zoneTag(i, i === selected)} onClick={() => setSelected(i === selected ? null : i)}>
            {z.name}
          </span>
        ))}
      </div>
      <div style={s.toolbar}>
        {!addingZone && !drawing && (
          <button style={s.btn('primary')} onClick={startAddZone}>+ Add Zone</button>
        )}
        {addingZone && !drawing && (
          <>
            <input
              style={s.input}
              placeholder="Zone name (e.g. NB)"
              value={newZoneName}
              onChange={e => setNewZoneName(e.target.value)}
              autoFocus
            />
            <button style={s.btn('primary')} onClick={confirmAddZone}>Start Drawing</button>
            <button style={s.btn()} onClick={cancelDrawing}>Cancel</button>
          </>
        )}
        {drawing && (
          <>
            <span style={s.hint}>Click to add vertices · double-click or click first vertex to close</span>
            <button style={s.btn()} onClick={cancelDrawing}>Cancel</button>
          </>
        )}
        {!drawing && selected != null && (
          <button style={s.btn('danger')} onClick={deleteSelected}>Delete Zone</button>
        )}
      </div>
    </div>
  )
}

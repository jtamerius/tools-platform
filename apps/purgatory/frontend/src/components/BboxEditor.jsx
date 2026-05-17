import { useEffect, useRef, useState, useCallback } from 'react'

const VEHICLE_COLOR = '#60a5fa'
const HANDLE_R = 6
const MIN_BOX = 8

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function hitBox(boxes, x, y) {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const { x1, y1, x2, y2 } = boxes[i]
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return i
  }
  return -1
}

function hitHandle(box, x, y) {
  const { x1, y1, x2, y2 } = box
  const corners = [
    { name: 'tl', cx: x1, cy: y1 },
    { name: 'tr', cx: x2, cy: y1 },
    { name: 'bl', cx: x1, cy: y2 },
    { name: 'br', cx: x2, cy: y2 },
  ]
  for (const c of corners) {
    if (Math.abs(x - c.cx) <= HANDLE_R && Math.abs(y - c.cy) <= HANDLE_R) return c.name
  }
  return null
}

export default function BboxEditor({ imageUrl, initialBoxes = [], imageWidth, imageHeight, onChange }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const [boxes, setBoxes] = useState(initialBoxes)
  const boxesRef = useRef(initialBoxes)
  const [selected, setSelected] = useState(null)
  const [dragging, setDragging] = useState(null) // {type: 'new'|'move'|'resize', ...}
  const [pendingBox, setPendingBox] = useState(null)
  const [imgRect, setImgRect] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const [imgNatural, setImgNatural] = useState({ w: imageWidth || 1, h: imageHeight || 1 })

  const commitBoxes = useCallback((next) => {
    boxesRef.current = next
    setBoxes(next)
    onChange?.(next)
  }, [onChange])

  const toCanvas = useCallback((ix, iy) => {
    return [
      imgRect.x + (ix / imgNatural.w) * imgRect.w,
      imgRect.y + (iy / imgNatural.h) * imgRect.h,
    ]
  }, [imgRect, imgNatural])

  const toImage = useCallback((cx, cy) => {
    return [
      clamp(((cx - imgRect.x) / imgRect.w) * imgNatural.w, 0, imgNatural.w),
      clamp(((cy - imgRect.y) / imgRect.h) * imgNatural.h, 0, imgNatural.h),
    ]
  }, [imgRect, imgNatural])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, imgRect.x, imgRect.y, imgRect.w, imgRect.h)

    const allBoxes = [...boxes]
    if (pendingBox) allBoxes.push({ ...pendingBox, cls: -1 })

    allBoxes.forEach((box, bi) => {
      const [cx1, cy1] = toCanvas(box.x1, box.y1)
      const [cx2, cy2] = toCanvas(box.x2, box.y2)
      const isSel = bi === selected && !pendingBox

      ctx.strokeStyle = isSel ? '#fff' : VEHICLE_COLOR
      ctx.lineWidth = isSel ? 2 : 1.5
      ctx.strokeRect(cx1, cy1, cx2 - cx1, cy2 - cy1)
      ctx.fillStyle = VEHICLE_COLOR + '22'
      ctx.fillRect(cx1, cy1, cx2 - cx1, cy2 - cy1)

      if (isSel) {
        [[cx1, cy1], [cx2, cy1], [cx1, cy2], [cx2, cy2]].forEach(([hx, hy]) => {
          ctx.fillStyle = '#fff'
          ctx.strokeStyle = VEHICLE_COLOR
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.rect(hx - HANDLE_R, hy - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2)
          ctx.fill()
          ctx.stroke()
        })
      }

      if (box.cls !== -1) {
        ctx.fillStyle = VEHICLE_COLOR
        ctx.font = '11px monospace'
        ctx.fillText('vehicle', cx1 + 3, cy1 + 13)
      }
    })
  }, [boxes, selected, pendingBox, imgRect, toCanvas])

  useEffect(() => { draw() }, [draw])

  const updateLayout = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete) return
    const cw = canvas.width, ch = canvas.height
    const iw = img.naturalWidth, ih = img.naturalHeight
    setImgNatural({ w: imageWidth || iw, h: imageHeight || ih })
    const scale = Math.min(cw / iw, ch / ih)
    const dw = iw * scale, dh = ih * scale
    setImgRect({ x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh })
  }, [imageWidth, imageHeight])

  useEffect(() => { updateLayout() }, [updateLayout, imageUrl])

  const canvasXY = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy]
  }

  const imgXY = (e) => toImage(...canvasXY(e))

  const handleMouseDown = (e) => {
    const [cx, cy] = canvasXY(e)
    const [ix, iy] = toImage(cx, cy)

    // Check handle hit on selected box
    if (selected != null && boxes[selected]) {
      const h = hitHandle(boxes[selected], ix, iy)
      if (h) {
        setDragging({ type: 'resize', handle: h, startIx: ix, startIy: iy, origBox: { ...boxes[selected] } })
        return
      }
    }

    // Check box hit
    const bi = hitBox(boxes.map(b => b), ix, iy)
    if (bi !== -1) {
      setSelected(bi)
      setDragging({ type: 'move', startIx: ix, startIy: iy, origBox: { ...boxes[bi] } })
      return
    }

    // Start new box
    setSelected(null)
    setDragging({ type: 'new', startIx: ix, startIy: iy })
    setPendingBox({ x1: ix, y1: iy, x2: ix, y2: iy })
  }

  const handleMouseMove = (e) => {
    if (!dragging) return
    const [ix, iy] = imgXY(e)
    const iw = imgNatural.w, ih = imgNatural.h

    if (dragging.type === 'new') {
      setPendingBox({
        x1: Math.min(dragging.startIx, ix),
        y1: Math.min(dragging.startIy, iy),
        x2: Math.max(dragging.startIx, ix),
        y2: Math.max(dragging.startIy, iy),
      })
    } else if (dragging.type === 'move') {
      const dx = ix - dragging.startIx, dy = iy - dragging.startIy
      const { x1, y1, x2, y2 } = dragging.origBox
      const bw = x2 - x1, bh = y2 - y1
      const nx1 = clamp(x1 + dx, 0, iw - bw)
      const ny1 = clamp(y1 + dy, 0, ih - bh)
      const next = boxes.map((b, i) => i === selected ? { ...b, x1: nx1, y1: ny1, x2: nx1 + bw, y2: ny1 + bh } : b)
      boxesRef.current = next
      setBoxes(next)
    } else if (dragging.type === 'resize') {
      const { origBox, handle } = dragging
      let { x1, y1, x2, y2 } = origBox
      if (handle === 'tl') { x1 = clamp(ix, 0, x2 - MIN_BOX); y1 = clamp(iy, 0, y2 - MIN_BOX) }
      if (handle === 'tr') { x2 = clamp(ix, x1 + MIN_BOX, iw); y1 = clamp(iy, 0, y2 - MIN_BOX) }
      if (handle === 'bl') { x1 = clamp(ix, 0, x2 - MIN_BOX); y2 = clamp(iy, y1 + MIN_BOX, ih) }
      if (handle === 'br') { x2 = clamp(ix, x1 + MIN_BOX, iw); y2 = clamp(iy, y1 + MIN_BOX, ih) }
      const next = boxes.map((b, i) => i === selected ? { ...b, x1, y1, x2, y2 } : b)
      boxesRef.current = next
      setBoxes(next)
    }
  }

  const handleMouseUp = (e) => {
    if (dragging?.type === 'new' && pendingBox) {
      const w = pendingBox.x2 - pendingBox.x1
      const h = pendingBox.y2 - pendingBox.y1
      if (w > MIN_BOX && h > MIN_BOX) {
        const newBox = { ...pendingBox, cls: 0, source: 'manual' }
        const next = [...boxesRef.current, newBox]
        commitBoxes(next)
        setSelected(next.length - 1)
      }
      setPendingBox(null)
    }
    // Commit move/resize to parent using ref (avoids stale closure)
    if (dragging?.type === 'move' || dragging?.type === 'resize') {
      onChange?.(boxesRef.current)
    }
    setDragging(null)
  }

  const deleteSelected = () => {
    if (selected == null) return
    commitBoxes(boxes.filter((_, i) => i !== selected))
    setSelected(null)
  }

  useEffect(() => {
    const onKey = (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && selected != null) deleteSelected() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, boxes])

  const cursor = dragging?.type === 'resize' ? 'nwse-resize' : dragging?.type === 'move' ? 'grab' : 'crosshair'

  const s = {
    wrap: { position: 'relative', userSelect: 'none' },
    canvas: { display: 'block', width: '100%', cursor, borderRadius: 4, background: '#0f1117' },
    toolbar: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' },
    btn: { padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)', background: '#7f1d1d', color: 'var(--text)', fontSize: 13, cursor: 'pointer' },
  }

  return (
    <div style={s.wrap}>
      <img ref={imgRef} src={imageUrl} onLoad={updateLayout} style={{ display: 'none' }} alt="" />
      <canvas
        ref={canvasRef}
        width={960}
        height={540}
        style={s.canvas}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />
      <div style={s.toolbar}>
        <span>{boxes.length} box{boxes.length !== 1 ? 'es' : ''} · drag to draw · click to select · Del to remove</span>
        {selected != null && (
          <button style={s.btn} onClick={deleteSelected}>Delete Box</button>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef } from 'react'

const CA = { r: 72,  g: 210, b: 195 }
const CB = { r: 160, g: 230, b: 100 }

function blend(t) {
  return {
    r: Math.round(CA.r + (CB.r - CA.r) * t),
    g: Math.round(CA.g + (CB.g - CA.g) * t),
    b: Math.round(CA.b + (CB.b - CA.b) * t),
  }
}

export default function DataMeshCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animId
    let w, h

    const N_INIT = 70
    const MAX_DIST_RATIO = 0.18
    const ATTRACT_RADIUS = 180
    const ATTRACT_STRENGTH = 0.02
    const MAX_SPEED = 3.0
    const DAMPING = 0.97

    const nodes = Array.from({ length: N_INIT }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      r: 1.4 + Math.random() * 1.8,
      hue: Math.random(),
    }))

    const pinnedEdges = []
    const mouse = { x: null, y: null }

    function resize() {
      const dpr = window.devicePixelRatio || 1
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.scale(dpr, dpr)
    }
    resize()

    // Listen on window so hover works even over page content
    function onMouseMove(e) { mouse.x = e.clientX; mouse.y = e.clientY }
    function onMouseLeave() { mouse.x = null; mouse.y = null }
    function onClick(e) {
      const cx = e.clientX, cy = e.clientY
      let nearestIdx = 0, nearestDist = Infinity
      for (let i = 0; i < nodes.length; i++) {
        const dx = nodes[i].x - cx, dy = nodes[i].y - cy
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < nearestDist) { nearestDist = d; nearestIdx = i }
      }
      const newIdx = nodes.length
      nodes.push({ x: cx, y: cy, vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18, r: 2.4 + Math.random() * 1.2, hue: Math.random() })
      pinnedEdges.push({ i: newIdx, j: nearestIdx })
    }

    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseleave', onMouseLeave)
    window.addEventListener('click', onClick)

    function draw() {
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#0d0d0d'
      ctx.fillRect(0, 0, w, h)

      const MAX_DIST = w * MAX_DIST_RATIO
      const N = nodes.length

      for (const n of nodes) {
        if (mouse.x !== null) {
          const dx = mouse.x - n.x, dy = mouse.y - n.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < ATTRACT_RADIUS && dist > 0.5) {
            const force = (1 - dist / ATTRACT_RADIUS) * ATTRACT_STRENGTH
            n.vx += (dx / dist) * force
            n.vy += (dy / dist) * force
          }
        }
        n.vx *= DAMPING; n.vy *= DAMPING
        const spd = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
        if (spd > MAX_SPEED) { n.vx = (n.vx / spd) * MAX_SPEED; n.vy = (n.vy / spd) * MAX_SPEED }
        n.x += n.vx; n.y += n.vy
        if (n.x < 0 || n.x > w) { n.vx *= -1; n.x = Math.max(0, Math.min(w, n.x)) }
        if (n.y < 0 || n.y > h) { n.vy *= -1; n.y = Math.max(0, Math.min(h, n.y)) }
      }

      for (const { i, j } of pinnedEdges) {
        if (!nodes[i] || !nodes[j]) continue
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const edgeHue = (nodes[i].hue + nodes[j].hue) / 2
        const { r, g, b } = blend(edgeHue)
        const alpha = Math.max(0.08, 0.5 * (1 - dist / (MAX_DIST * 2.5)))
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
        ctx.lineWidth = 0.7
        ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke()
        ctx.setLineDash([])
      }

      const nodeColorSum = nodes.map(() => ({ hueSum: 0, weightSum: 0 }))
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAX_DIST) {
            const proximity = 1 - dist / MAX_DIST
            const brightness = Math.pow(proximity, 1.6)
            const edgeHue = (nodes[i].hue + nodes[j].hue) / 2
            const { r, g, b } = blend(edgeHue)
            ctx.strokeStyle = `rgba(${r},${g},${b},${brightness * 0.55})`
            ctx.lineWidth = 0.5 + brightness * 0.8
            ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke()
            nodeColorSum[i].hueSum += edgeHue * brightness; nodeColorSum[i].weightSum += brightness
            nodeColorSum[j].hueSum += edgeHue * brightness; nodeColorSum[j].weightSum += brightness
          }
        }
      }

      for (let i = 0; i < N; i++) {
        const n = nodes[i]
        const nc = nodeColorSum[i]
        const nodeHue = nc.weightSum > 0 ? nc.hueSum / nc.weightSum : n.hue
        const { r, g, b } = blend(nodeHue)
        const glow = Math.min(1, nc.weightSum * 0.6)
        ctx.fillStyle = `rgba(${r},${g},${b},${0.35 + glow * 0.55})`
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (0.8 + glow * 0.5), 0, Math.PI * 2); ctx.fill()
      }

      animId = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('click', onClick)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        display: 'block',
        pointerEvents: 'none',
      }}
    />
  )
}

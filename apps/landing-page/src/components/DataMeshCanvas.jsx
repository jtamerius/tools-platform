import { useEffect, useRef } from 'react'
import { Delaunay } from 'd3-delaunay'

const HUE_A = 172, HUE_B = 155, HUE_RANGE = 30
const N_INIT = 42
const MAX_SPEED = 0.3, DAMPING = 0.996, MIN_DIST = 60
const ATTRACT_RADIUS = 180, ATTRACT_STRENGTH = 0.006

function clampHue(v) {
  return Math.max(Math.min(HUE_A, HUE_B) - 15, Math.min(Math.max(HUE_A, HUE_B) + 15, v))
}

function makeNode(x, y, w, h) {
  return {
    x: x !== undefined ? x : Math.random() * w,
    y: y !== undefined ? y : Math.random() * h,
    vx: (Math.random() - 0.5) * 0.15,
    vy: (Math.random() - 0.5) * 0.15,
    hue: HUE_A + (Math.random() - 0.5) * HUE_RANGE,
    flexPhase: Math.random() * Math.PI * 2,
    flexSpeed: 0.003 + Math.random() * 0.004,
    speed: 0,
  }
}

function diffuseHues(nodes, tri) {
  const sums = nodes.map(() => ({ hue: 0, count: 0 }))
  for (let k = 0; k < tri.length; k += 3) {
    for (const [a, b] of [[tri[k], tri[k+1]], [tri[k+1], tri[k+2]], [tri[k], tri[k+2]]]) {
      if (!nodes[a] || !nodes[b]) continue
      sums[a].hue += nodes[b].hue; sums[a].count++
      sums[b].hue += nodes[a].hue; sums[b].count++
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    if (sums[i]?.count > 0) {
      nodes[i].hue += (sums[i].hue / sums[i].count - nodes[i].hue) * 0.002
      nodes[i].hue = clampHue(nodes[i].hue)
    }
  }
}

export default function DataMeshCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animId
    let w, h

    const nodes = Array.from({ length: N_INIT }, () => makeNode(undefined, undefined, window.innerWidth, window.innerHeight))
    const mouse = { x: null, y: null }

    function resize() {
      const dpr = window.devicePixelRatio || 1
      w = window.innerWidth; h = window.innerHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    function onMouseMove(e) { mouse.x = e.clientX; mouse.y = e.clientY }
    function onMouseLeave() { mouse.x = null; mouse.y = null }
    function onClick(e) { nodes.push(makeNode(e.clientX, e.clientY, w, h)) }

    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseleave', onMouseLeave)
    window.addEventListener('click', onClick)

    function draw() {
      const now = performance.now()
      const nCount = nodes.length

      for (let i = 0; i < nCount; i++) {
        const n = nodes[i]

        if (mouse.x !== null) {
          const dx = mouse.x - n.x, dy = mouse.y - n.y
          const d = Math.sqrt(dx*dx + dy*dy)
          if (d < ATTRACT_RADIUS && d > 0.5) {
            const f = (1 - d / ATTRACT_RADIUS) * ATTRACT_STRENGTH
            n.vx += (dx / d) * f; n.vy += (dy / d) * f
          }
        }

        const cx = n.x - w / 2, cy = n.y - h / 2
        const cd = Math.sqrt(cx*cx + cy*cy) || 0.01
        const ag = Math.min(cd / (Math.min(w, h) * 0.5), 1) * 0.002
        n.vx += (cx / cd) * ag; n.vy += (cy / cd) * ag

        for (let j = i + 1; j < nCount; j++) {
          const rx = n.x - nodes[j].x, ry = n.y - nodes[j].y
          const rd = Math.sqrt(rx*rx + ry*ry) || 0.01
          if (rd < MIN_DIST) {
            const f = (MIN_DIST - rd) / MIN_DIST * 0.25
            n.vx += (rx/rd)*f; n.vy += (ry/rd)*f
            nodes[j].vx -= (rx/rd)*f; nodes[j].vy -= (ry/rd)*f
          }
        }

        n.vx *= DAMPING; n.vy *= DAMPING
        const spd = Math.sqrt(n.vx*n.vx + n.vy*n.vy)
        if (spd > MAX_SPEED) { n.vx = (n.vx/spd)*MAX_SPEED; n.vy = (n.vy/spd)*MAX_SPEED }
        n.speed = spd
        n.x += n.vx; n.y += n.vy

        if (n.x < -80 || n.x > w + 80 || n.y < -80 || n.y > h + 80) {
          n.x = w * 0.3 + Math.random() * w * 0.4
          n.y = h * 0.3 + Math.random() * h * 0.4
          n.vx = (Math.random() - 0.5) * 0.1
          n.vy = (Math.random() - 0.5) * 0.1
        }
      }

      const pts = new Float64Array(nodes.flatMap(nd => [nd.x, nd.y]))
      const delaunay = new Delaunay(pts)
      const voronoi = delaunay.voronoi([0, 0, w, h])
      diffuseHues(nodes, delaunay.triangles)

      const rawSin = Math.sin((now / 12000) * Math.PI * 2)
      const fade = 0.5 + 0.5 * Math.sign(rawSin) * Math.pow(Math.abs(rawSin), 0.8)
      const voroA = 1 - fade * 0.85
      const meshA = fade

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#0d0d0d'
      ctx.fillRect(0, 0, w, h)

      for (let i = 0; i < nCount; i++) {
        const cell = voronoi.cellPolygon(i)
        if (!cell || cell.length < 3) continue
        const speedFactor = Math.pow(Math.min(1, nodes[i].speed / MAX_SPEED), 3)
        const h_ = nodes[i].hue.toFixed(1)
        ctx.beginPath()
        ctx.moveTo(cell[0][0], cell[0][1])
        for (let k = 1; k < cell.length; k++) ctx.lineTo(cell[k][0], cell[k][1])
        ctx.closePath()
        ctx.strokeStyle = `hsla(${h_},65%,72%,${(voroA * (0.06 + speedFactor * 0.45)).toFixed(3)})`
        ctx.lineWidth = 0.5 + speedFactor * 0.6
        ctx.stroke()
      }

      const tri = delaunay.triangles
      for (let k = 0; k < tri.length; k += 3) {
        for (const [a, b] of [[tri[k], tri[k+1]], [tri[k+1], tri[k+2]], [tri[k], tri[k+2]]]) {
          if (!nodes[a] || !nodes[b]) continue
          const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y
          const dist = Math.sqrt(dx*dx + dy*dy)
          const prox = Math.max(0, 1 - dist / (Math.sqrt(w*w + h*h) * 0.35))
          const eh = ((nodes[a].hue + nodes[b].hue) / 2).toFixed(1)
          ctx.strokeStyle = `hsla(${eh},65%,65%,${(meshA * prox * 0.45).toFixed(3)})`
          ctx.lineWidth = 0.3 + prox * 0.7
          ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); ctx.stroke()
        }
      }

      for (let i = 0; i < nCount; i++) {
        const nd = nodes[i]
        const flex = 0.7 + 0.3 * Math.sin((now / 1000) * nd.flexSpeed + nd.flexPhase)
        ctx.fillStyle = `hsla(${nd.hue.toFixed(1)},65%,72%,${(0.28 + flex * 0.25).toFixed(2)})`
        ctx.beginPath(); ctx.arc(nd.x, nd.y, 1.4 + flex * 1.0, 0, Math.PI * 2); ctx.fill()
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

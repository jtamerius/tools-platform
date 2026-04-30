import { useEffect, useRef } from 'react'
import { Delaunay } from 'd3-delaunay'

const N_NODES = 80
const MAX_SPEED = 0.18
const DAMPING = 0.997
const MIN_DIST = 70

function makeNode(w, h) {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.12,
    vy: (Math.random() - 0.5) * 0.12,
  }
}

export default function SubtleVoronoiCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animId
    let w, h

    const nodes = Array.from({ length: N_NODES }, () =>
      makeNode(window.innerWidth, window.innerHeight)
    )

    function resize() {
      const dpr = window.devicePixelRatio || 1
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    function draw() {
      const n = nodes.length

      for (let i = 0; i < n; i++) {
        const nd = nodes[i]

        // Gentle repulsion between nearby nodes
        for (let j = i + 1; j < n; j++) {
          const rx = nd.x - nodes[j].x, ry = nd.y - nodes[j].y
          const rd = Math.sqrt(rx * rx + ry * ry) || 0.01
          if (rd < MIN_DIST) {
            const f = (MIN_DIST - rd) / MIN_DIST * 0.15
            nd.vx += (rx / rd) * f; nd.vy += (ry / rd) * f
            nodes[j].vx -= (rx / rd) * f; nodes[j].vy -= (ry / rd) * f
          }
        }

        nd.vx *= DAMPING; nd.vy *= DAMPING
        const spd = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy)
        if (spd > MAX_SPEED) { nd.vx = (nd.vx / spd) * MAX_SPEED; nd.vy = (nd.vy / spd) * MAX_SPEED }
        nd.x += nd.vx; nd.y += nd.vy

        if (nd.x < -80 || nd.x > w + 80 || nd.y < -80 || nd.y > h + 80) {
          nd.x = w * 0.2 + Math.random() * w * 0.6
          nd.y = h * 0.2 + Math.random() * h * 0.6
          nd.vx = (Math.random() - 0.5) * 0.08
          nd.vy = (Math.random() - 0.5) * 0.08
        }
      }

      const pts = new Float64Array(nodes.flatMap(nd => [nd.x, nd.y]))
      const delaunay = new Delaunay(pts)
      const voronoi = delaunay.voronoi([0, 0, w, h])

      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(0,0,0,0.045)'
      ctx.lineWidth = 0.75

      for (let i = 0; i < n; i++) {
        const cell = voronoi.cellPolygon(i)
        if (!cell || cell.length < 3) continue
        ctx.beginPath()
        ctx.moveTo(cell[0][0], cell[0][1])
        for (let k = 1; k < cell.length; k++) ctx.lineTo(cell[k][0], cell[k][1])
        ctx.closePath()
        ctx.stroke()
      }

      animId = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
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

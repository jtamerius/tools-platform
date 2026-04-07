import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ─── Texture URLs ──────────────────────────────────────────────────────────────
const TEXTURE_BASE = 'https://unpkg.com/three-globe@2.31.1/example/img'
const TEX_DAY      = `${TEXTURE_BASE}/earth-blue-marble.jpg`
const TEX_NIGHT    = `${TEXTURE_BASE}/earth-night.jpg`
const TEX_TOPO     = `${TEXTURE_BASE}/earth-topology.png`
const TEX_WATER    = `${TEXTURE_BASE}/earth-water.png`
const TEX_CLOUDS   = `${TEXTURE_BASE}/clouds.png`

// NASA GIBS WMS — LIS/OTD lightning flash rate climatology (equirectangular, transparent PNG)
const TEX_LIGHTNING = [
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
  '?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0',
  '&LAYERS=LIS_OTD_Lightning_Flash_Climatology',
  '&CRS=CRS:84&BBOX=-180,-90,180,90',
  '&WIDTH=2048&HEIGHT=1024&FORMAT=image/png&TRANSPARENT=true',
].join('')

// ─── Earth Shaders ─────────────────────────────────────────────────────────────
const EARTH_VERT = /* glsl */`
  varying vec2  vUv;
  varying vec3  vNormal;
  varying vec3  vWorldPos;

  void main() {
    vUv      = uv;
    vNormal  = normalize(mat3(modelMatrix) * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`

const EARTH_FRAG = /* glsl */`
  uniform sampler2D dayTex;
  uniform sampler2D nightTex;
  uniform sampler2D topoTex;
  uniform sampler2D waterTex;
  uniform vec3      sunDir;
  uniform vec3      camPos;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3  N       = normalize(vNormal);
    float sunDot  = dot(N, normalize(sunDir));

    // — Day / Night textures
    vec4 dayColor   = texture2D(dayTex,   vUv);
    vec4 nightColor = texture2D(nightTex, vUv);

    // Soft terminator band
    float blend = smoothstep(-0.08, 0.15, sunDot);
    vec4  earth = mix(nightColor, dayColor, blend);

    // — Topographic bump shading (subtle)
    vec4 topo   = texture2D(topoTex, vUv);
    float bump  = (topo.r - 0.5) * 0.06;
    float diffuse = max(0.0, sunDot + bump);
    earth.rgb  *= 0.15 + 0.85 * diffuse;

    // — Subtle ambient so dark side isn't pure black
    earth.rgb = max(earth.rgb, nightColor.rgb * 0.06);

    gl_FragColor = vec4(earth.rgb, 1.0);
  }
`

// ─── Atmosphere Shaders ────────────────────────────────────────────────────────
const ATMO_VERT = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vNormal   = normalize(mat3(modelMatrix) * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`

const ATMO_FRAG = /* glsl */`
  uniform vec3 sunDir;
  uniform vec3 camPos;

  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3  N       = normalize(vNormal);
    vec3  V       = normalize(camPos - vWorldPos);
    float sunDot  = dot(N, normalize(sunDir));

    // Fresnel rim
    float rim     = 1.0 - abs(dot(V, N));
    float fresnel = pow(rim, 3.5);

    // Day side is bright blue, terminator fades to deep indigo, night side fades
    float lit = smoothstep(-0.4, 0.6, sunDot);
    vec3 dayAtmo  = vec3(0.28, 0.60, 1.00);
    vec3 twilight = vec3(0.40, 0.18, 0.60);
    vec3 nightAtmo= vec3(0.04, 0.06, 0.18);

    vec3 color;
    if (sunDot > 0.0) {
      color = mix(twilight, dayAtmo, smoothstep(0.0, 0.3, sunDot));
    } else {
      color = mix(nightAtmo, twilight, smoothstep(-0.3, 0.0, sunDot));
    }

    float alpha = fresnel * (0.55 + 0.45 * lit);
    gl_FragColor = vec4(color, alpha);
  }
`

// ─── Cloud Shaders ─────────────────────────────────────────────────────────────
const CLOUD_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv     = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`

const CLOUD_FRAG = /* glsl */`
  uniform sampler2D cloudTex;
  uniform vec3      sunDir;

  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec3  N      = normalize(vNormal);
    float sunDot = dot(N, normalize(sunDir));

    vec4  cloud  = texture2D(cloudTex, vUv);
    float alpha  = cloud.r * 0.72;

    // Lit side: white clouds; dark side: very dim blue-grey
    float lit    = smoothstep(-0.15, 0.25, sunDot);
    vec3  color  = mix(vec3(0.04, 0.06, 0.12), vec3(1.0), lit);

    gl_FragColor = vec4(color, alpha);
  }
`

// ─── Stars Shaders ─────────────────────────────────────────────────────────────
const STARS_VERT = /* glsl */`
  attribute float aSize;
  attribute float aBrightness;
  varying   float vBrightness;

  void main() {
    vBrightness = aBrightness;
    vec4 mvPos   = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (400.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`

const STARS_FRAG = /* glsl */`
  varying float vBrightness;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = (1.0 - smoothstep(0.5, 1.0, d)) * vBrightness;
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
  }
`

// ─── Helpers ───────────────────────────────────────────────────────────────────
function calcSunDirection() {
  const now         = new Date()
  const dayOfYear   = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000)
  const decl        = -23.45 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10))
  const utcHours    = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
  const subSolarLon = (utcHours / 24 - 0.5) * -360
  return latLngToVec3(decl, subSolarLon, 1.0).normalize()
}

function latLngToVec3(lat, lng, r = 1) {
  const phi   = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  )
}

function buildStarField(count = 8000) {
  const positions   = new Float32Array(count * 3)
  const sizes       = new Float32Array(count)
  const brightnesses= new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * 2 * Math.PI
    const phi   = Math.acos(2 * Math.random() - 1)
    const r     = 900
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)
    sizes[i]        = 0.6 + Math.random() * 1.6
    brightnesses[i] = 0.3 + Math.random() * 0.7
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position',    new THREE.BufferAttribute(positions,    3))
  geo.setAttribute('aSize',       new THREE.BufferAttribute(sizes,        1))
  geo.setAttribute('aBrightness', new THREE.BufferAttribute(brightnesses, 1))
  return geo
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function Globe({ overlays = [] }) {
  const mountRef    = useRef(null)
  const rendererRef = useRef(null)
  const sceneRef    = useRef(null)
  const cameraRef   = useRef(null)
  const controlsRef = useRef(null)
  const uniformsRef = useRef(null)
  const rafRef      = useRef(null)
  const cloudMeshRef= useRef(null)

  // For overlay screen-position tracking
  const [overlayPositions, setOverlayPositions] = useState([])
  const overlayWorldPosRef = useRef([])

  // Recompute world positions whenever overlays change
  useEffect(() => {
    overlayWorldPosRef.current = overlays.map(o => latLngToVec3(o.lat, o.lng, 1.02))
  }, [overlays])

  const projectOverlays = useCallback(() => {
    if (!cameraRef.current || !rendererRef.current) return
    const cam = cameraRef.current
    const el  = rendererRef.current.domElement
    const w   = el.clientWidth
    const h   = el.clientHeight

    const positions = overlayWorldPosRef.current.map((worldPos, i) => {
      const v = worldPos.clone().project(cam)
      // Check if point is facing camera (dot with view direction)
      const toPoint = worldPos.clone().normalize()
      const toCam   = cam.position.clone().normalize()
      const facing  = toPoint.dot(toCam) > 0

      return {
        id:      overlays[i].id,
        x:       (v.x *  0.5 + 0.5) * w,
        y:       (v.y * -0.5 + 0.5) * h,
        visible: facing && v.z < 1,
      }
    })
    setOverlayPositions(positions)
  }, [overlays])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // ── Scene & Camera ──
    const scene  = new THREE.Scene()
    scene.background = new THREE.Color(0x000008)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 2000)
    camera.position.set(0, 0, 2.8)
    cameraRef.current = camera

    // ── Controls ──
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping    = true
    controls.dampingFactor    = 0.06
    controls.rotateSpeed      = 0.4
    controls.zoomSpeed        = 0.8
    controls.minDistance      = 1.25
    controls.maxDistance      = 8
    controls.enablePan        = false
    controlsRef.current = controls

    // ── Texture Loader ──
    const loader = new THREE.TextureLoader()
    const load   = (url, cb) => loader.load(url, cb)

    // ── Sun direction uniform (shared across materials) ──
    const sunDir = calcSunDirection()
    const sharedUniforms = {
      sunDir: { value: sunDir },
      camPos: { value: camera.position },
    }
    uniformsRef.current = sharedUniforms

    // ── Stars ──
    const starGeo = buildStarField(10000)
    const starMat = new THREE.ShaderMaterial({
      vertexShader:   STARS_VERT,
      fragmentShader: STARS_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    })
    scene.add(new THREE.Points(starGeo, starMat))

    // ── Earth ──
    const earthGeo = new THREE.SphereGeometry(1, 128, 128)
    const earthUniforms = {
      ...sharedUniforms,
      dayTex:   { value: null },
      nightTex: { value: null },
      topoTex:  { value: null },
      waterTex: { value: null },
    }
    const earthMat = new THREE.ShaderMaterial({
      vertexShader:   EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      uniforms:       earthUniforms,
    })
    const earthMesh = new THREE.Mesh(earthGeo, earthMat)
    scene.add(earthMesh)

    // ── Clouds ──
    const cloudGeo = new THREE.SphereGeometry(1.008, 96, 96)
    const cloudUniforms = {
      sunDir:   sharedUniforms.sunDir,
      cloudTex: { value: null },
    }
    const cloudMat = new THREE.ShaderMaterial({
      vertexShader:   CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms:       cloudUniforms,
      transparent:    true,
      depthWrite:     false,
    })
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat)
    cloudMeshRef.current = cloudMesh
    scene.add(cloudMesh)

    // ── Atmosphere ──
    const atmoGeo = new THREE.SphereGeometry(1.06, 64, 64)
    const atmoMat = new THREE.ShaderMaterial({
      vertexShader:   ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms:       { ...sharedUniforms },
      transparent:    true,
      depthWrite:     false,
      side:           THREE.FrontSide,
      blending:       THREE.AdditiveBlending,
    })
    scene.add(new THREE.Mesh(atmoGeo, atmoMat))

    // ── Load Textures ──
    load(TEX_DAY,    t => { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); earthUniforms.dayTex.value   = t })
    load(TEX_NIGHT,  t => { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); earthUniforms.nightTex.value = t })
    load(TEX_TOPO,   t => { earthUniforms.topoTex.value  = t })
    load(TEX_WATER,  t => { earthUniforms.waterTex.value = t })
    load(TEX_CLOUDS, t => { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); cloudUniforms.cloudTex.value = t })

    // ── Resize ──
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(container)

    // ── Animation Loop ──
    let frame = 0
    function animate() {
      rafRef.current = requestAnimationFrame(animate)
      frame++

      controls.update()

      sharedUniforms.sunDir.value.copy(calcSunDirection())

      // Slowly drift clouds (≈2× Earth rotation speed)
      if (cloudMesh) {
        cloudMesh.rotation.y += 0.00008
      }



      projectOverlays()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      starGeo.dispose()
      starMat.dispose()
      earthGeo.dispose()
      earthMat.dispose()
      cloudGeo.dispose()
      cloudMat.dispose()
      atmoGeo.dispose()
      atmoMat.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [projectOverlays])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Three.js canvas mount point */}
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* HTML Overlay layer */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {overlayPositions.map((pos) => {
          const overlay = overlays.find(o => o.id === pos.id)
          if (!overlay || !pos.visible) return null
          return (
            <div
              key={pos.id}
              style={{
                position:  'absolute',
                left:       pos.x,
                top:        pos.y,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'auto',
              }}
            >
              {overlay.content ?? <DefaultMarker overlay={overlay} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DefaultMarker({ overlay }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'default' }}
    >
      {/* Dot */}
      <div
        style={{
          width:        10,
          height:       10,
          borderRadius: '50%',
          background:   overlay.color ?? '#4af',
          boxShadow:    `0 0 ${hovered ? 10 : 5}px ${overlay.color ?? '#4af'}`,
          transition:   'box-shadow 0.2s',
          border:       '1.5px solid rgba(255,255,255,0.7)',
        }}
      />
      {/* Label */}
      {(hovered || overlay.alwaysVisible) && (
        <div
          style={{
            marginTop:    6,
            background:   'rgba(10,12,20,0.82)',
            backdropFilter: 'blur(6px)',
            border:       '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            padding:      '4px 10px',
            color:        '#e8e8f0',
            fontSize:     '0.72rem',
            fontWeight:   600,
            letterSpacing:'0.04em',
            whiteSpace:   'nowrap',
            pointerEvents:'none',
          }}
        >
          {overlay.label}
        </div>
      )}
    </div>
  )
}

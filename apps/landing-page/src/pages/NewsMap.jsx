import { useState, useEffect, useMemo, useRef } from 'react'
import { Map, useControl } from 'react-map-gl/maplibre'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { GeoJsonLayer, ArcLayer } from '@deck.gl/layers'

// ── Map style ─────────────────────────────────────────────────────────────────
const CARTO_DARK =
  'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'
const TOPO_URL =
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

const INITIAL_VIEW = {
  longitude: 10,
  latitude: 20,
  zoom: 1.05,
  pitch: 0,
  bearing: 0,
  minZoom: 0.5,
  maxZoom: 8,
}

// ── Category → color ──────────────────────────────────────────────────────────
export const CATEGORY_COLORS = {
  'Politics':           '#e05c5c',
  'Elections':          '#ff8c42',
  'War & Conflict':     '#c94040',
  'Diplomacy':          '#7bb3ff',
  'Economy':            '#f4d35e',
  'Energy':             '#f77f00',
  'Environment':        '#4caf50',
  'Crime & Justice':    '#ab47bc',
  'Health':             '#26c6da',
  'Natural Disasters':  '#ff7043',
  'Technology':         '#42a5f5',
  'Social Issues':      '#ec407a',
  'Business':           '#66bb6a',
  'Sports':             '#ffca28',
  'Science':            '#5e97f6',
}
const DEFAULT_COLOR = '#2a3a4a'

// ── ISO numeric → alpha-2 ─────────────────────────────────────────────────────
const ISO_NUM_TO_A2 = {
   12:'DZ',  32:'AR',  36:'AU',  40:'AT',  50:'BD',
   56:'BE',  68:'BO',  76:'BR', 100:'BG', 112:'BY',
  120:'CM', 124:'CA', 144:'LK', 152:'CL', 156:'CN',
  158:'TW', 170:'CO', 188:'CR', 191:'HR', 192:'CU',
  203:'CZ', 208:'DK', 214:'DO', 218:'EC', 222:'SV',
  231:'ET', 233:'EE', 246:'FI', 250:'FR', 276:'DE',
  288:'GH', 300:'GR', 320:'GT', 340:'HN', 344:'HK',
  348:'HU', 356:'IN', 360:'ID', 368:'IQ', 372:'IE',
  376:'IL', 380:'IT', 384:'CI', 392:'JP', 400:'JO',
  404:'KE', 410:'KR', 414:'KW', 422:'LB', 428:'LV',
  434:'LY', 440:'LT', 442:'LU', 458:'MY', 484:'MX',
  496:'MN', 504:'MA', 524:'NP', 528:'NL', 554:'NZ',
  558:'NI', 566:'NG', 578:'NO', 586:'PK', 591:'PA',
  600:'PY', 604:'PE', 608:'PH', 616:'PL', 620:'PT',
  630:'PR', 642:'RO', 643:'RU', 682:'SA', 686:'SN',
  688:'RS', 702:'SG', 703:'SK', 704:'VN', 705:'SI',
  710:'ZA', 724:'ES', 752:'SE', 756:'CH', 764:'TH',
  784:'AE', 788:'TN', 792:'TR', 800:'UG', 804:'UA',
  818:'EG', 826:'GB', 834:'TZ', 840:'US', 858:'UY',
  862:'VE',
}

// ── Country centroids [lon, lat] ──────────────────────────────────────────────
const CENTROIDS = {
  DZ:[ 3.0, 28.0], AR:[-64.0,-34.0], AU:[134.0,-25.0], AT:[ 14.5, 47.5],
  BD:[ 90.4, 23.7], BE:[  4.5, 50.5], BO:[-64.9,-16.3], BR:[-51.9,-14.2],
  BG:[ 25.5, 42.7], BY:[ 28.0, 53.5], CM:[ 12.4,  5.7], CA:[-96.8, 56.1],
  LK:[ 80.7,  7.9], CL:[-71.5,-35.7], CN:[104.2, 35.9], TW:[121.0, 23.7],
  CO:[-74.3,  4.1], CR:[-84.2,  9.7], HR:[ 15.2, 45.1], CU:[-79.5, 21.5],
  CZ:[ 15.5, 49.8], DK:[  9.5, 56.3], DO:[-70.2, 18.7], EC:[-78.1, -1.8],
  SV:[-88.9, 13.8], ET:[ 40.5,  9.1], EE:[ 25.0, 58.6], FI:[ 25.7, 64.6],
  FR:[  2.2, 46.2], DE:[ 10.5, 51.2], GH:[ -1.0,  7.9], GR:[ 21.8, 39.1],
  GT:[-90.2, 15.8], HN:[-86.6, 15.2], HK:[114.2, 22.3], HU:[ 19.5, 47.2],
  IN:[ 78.7, 22.0], ID:[117.9, -2.5], IQ:[ 43.7, 33.2], IE:[ -8.2, 53.2],
  IL:[ 34.9, 31.0], IT:[ 12.6, 42.5], CI:[ -5.6,  7.5], JP:[138.3, 36.2],
  JO:[ 36.2, 30.6], KE:[ 37.9,  0.0], KR:[127.8, 36.5], KW:[ 47.6, 29.3],
  LB:[ 35.9, 33.9], LV:[ 24.9, 56.9], LY:[ 17.2, 27.0], LT:[ 24.0, 55.9],
  LU:[  6.1, 49.8], MY:[109.7,  4.2], MX:[-102.5,23.6], MN:[103.8, 46.9],
  MA:[ -6.0, 32.0], NP:[ 84.2, 28.4], NL:[  5.3, 52.1], NZ:[172.5,-41.5],
  NI:[-85.0, 12.9], NG:[  8.7,  9.1], NO:[ 10.2, 60.5], PK:[ 69.3, 30.4],
  PA:[-80.0,  8.5], PY:[-58.4,-23.2], PE:[-75.0, -9.2], PH:[122.9, 12.9],
  PL:[ 19.1, 51.9], PT:[ -8.2, 39.6], PR:[-66.6, 18.2], RO:[ 24.9, 45.9],
  RU:[ 60.0, 60.0], SA:[ 45.1, 24.7], SN:[-14.5, 14.5], RS:[ 21.0, 44.0],
  SG:[103.8,  1.4], SK:[ 19.7, 48.7], VN:[106.3, 16.6], SI:[ 14.8, 46.1],
  ZA:[ 25.1,-29.0], ES:[ -3.7, 40.4], SE:[ 18.6, 62.0], CH:[  8.2, 46.8],
  TH:[101.0, 15.9], AE:[ 54.0, 24.0], TN:[  9.5, 34.0], TR:[ 35.2, 39.1],
  UG:[ 32.3,  1.4], UA:[ 31.2, 48.4], EG:[ 29.9, 26.8], GB:[ -1.5, 52.5],
  TZ:[ 34.9, -6.4], US:[-98.6, 39.5], UY:[-56.0,-32.5], VE:[-66.6,  8.0],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const n = parseInt((hex || DEFAULT_COLOR).replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function topicColor(topic, countryData) {
  const counts = {}
  Object.values(countryData).forEach(d => {
    if (d?.arcGroup === topic && d?.label)
      counts[d.label] = (counts[d.label] || 0) + 1
  })
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
  return CATEGORY_COLORS[top] ?? '#aabbff'
}

function buildArcPairs(countryData, activeTopic, hoveredCode) {
  if (!activeTopic || activeTopic === '__other__') return []

  const members = Object.entries(countryData)
    .filter(([code, d]) => d?.arcGroup === activeTopic && CENTROIDS[code])
    .map(([code]) => code)

  if (members.length < 2) return []

  const pairs = []

  if (hoveredCode && CENTROIDS[hoveredCode] && countryData[hoveredCode]?.arcGroup === activeTopic) {
    const from = CENTROIDS[hoveredCode]
    members.forEach(code => {
      if (code !== hoveredCode)
        pairs.push({ source: from, target: CENTROIDS[code] })
    })
  } else if (members.length <= 8) {
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++)
        pairs.push({ source: CENTROIDS[members[i]], target: CENTROIDS[members[j]] })
  } else {
    const lons = members.map(c => CENTROIDS[c][0])
    const lats = members.map(c => CENTROIDS[c][1])
    const center = [
      lons.reduce((a, b) => a + b, 0) / lons.length,
      lats.reduce((a, b) => a + b, 0) / lats.length,
    ]
    members.forEach(code => pairs.push({ source: center, target: CENTROIDS[code] }))
  }

  return pairs
}

// ── MapboxOverlay bridge (must render inside <Map>) ───────────────────────────
function DeckBridge({ layers }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }))
  overlay.setProps({ layers })
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewsMap({ countryData = {} }) {
  const containerRef = useRef(null)
  const [geoJson, setGeoJson] = useState(null)
  const [hoveredCode, setHoveredCode] = useState(null)
  const [activeLegendTopic, setActiveLegendTopic] = useState(null)
  const [tooltip, setTooltip] = useState(null)

  useEffect(() => {
    fetch(TOPO_URL)
      .then(r => r.json())
      .then(async topo => {
        const { feature } = await import('topojson-client')
        setGeoJson(feature(topo, topo.objects.countries))
      })
  }, [])

  const topTopics = useMemo(() => {
    const counts = {}
    Object.values(countryData).forEach(d => {
      if (d?.arcGroup) counts[d.arcGroup] = (counts[d.arcGroup] || 0) + 1
    })
    return Object.entries(counts)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([topic, count]) => ({ topic, count }))
  }, [countryData])

  const topTopicSet = useMemo(() => new Set(topTopics.map(t => t.topic)), [topTopics])

  const hoveredTopic = hoveredCode ? (countryData[hoveredCode]?.arcGroup ?? null) : null
  const activeTopic = activeLegendTopic ?? hoveredTopic

  // Arcs: recompute when activeTopic or hover changes
  const arcPairs = buildArcPairs(countryData, activeTopic, hoveredCode)
  const arcHex = activeTopic ? topicColor(activeTopic, countryData) : '#aabbff'
  const arcRgb = hexToRgb(arcHex)

  // ── Layers — computed fresh each render so closures are always current ──────
  const isOther = activeTopic === '__other__'

  const layers = geoJson ? [
    new GeoJsonLayer({
      id: 'countries',
      data: geoJson,
      pickable: true,
      filled: true,
      stroked: true,
      getFillColor: f => {
        const a2 = ISO_NUM_TO_A2[+f.id]
        const d = a2 ? countryData[a2] : null
        if (!d) return [30, 45, 60, 220]   // uncategorized: dark teal, still visible
        const [r, g, b] = hexToRgb(CATEGORY_COLORS[d.label] ?? DEFAULT_COLOR)
        const inOther = isOther && d.arcGroup && !topTopicSet.has(d.arcGroup)
        const dimmed = activeTopic && (isOther ? !inOther : d.arcGroup !== activeTopic)
        return [r, g, b, dimmed ? 28 : 200]
      },
      getLineColor: f => {
        const a2 = ISO_NUM_TO_A2[+f.id]
        const d = a2 ? countryData[a2] : null
        if (!d) return [50, 65, 80, 120]
        const [r, g, b] = hexToRgb(CATEGORY_COLORS[d.label] ?? DEFAULT_COLOR)
        return [r, g, b, 80]
      },
      lineWidthMinPixels: 0.6,
      onHover: ({ object, x, y }) => {
        if (!object) { setHoveredCode(null); setTooltip(null); return }
        const a2 = ISO_NUM_TO_A2[+object.id]
        setHoveredCode(a2 ?? null)
        setTooltip(a2 ? { x, y, code: a2, info: countryData[a2] } : null)
      },
      updateTriggers: {
        getFillColor: [countryData, activeTopic, topTopicSet],
        getLineColor: [countryData],
      },
    }),
    ...(arcPairs.length > 0 ? [new ArcLayer({
      id: 'arcs',
      data: arcPairs,
      getSourcePosition: d => d.source,
      getTargetPosition: d => d.target,
      getSourceColor: [arcRgb[0], arcRgb[1], arcRgb[2], 240],
      getTargetColor: [arcRgb[0], arcRgb[1], arcRgb[2], 100],
      getWidth: 2.5,
      greatCircle: true,
      opacity: 1,
    })] : []),
  ] : []

  return (
    <div style={styles.wrap}>
      <div ref={containerRef} style={styles.mapContainer}>
        <Map
          initialViewState={INITIAL_VIEW}
          mapStyle={CARTO_DARK}
          style={{ width: '100%', height: '100%' }}
          attributionControl={false}
        >
          <DeckBridge layers={layers} />
        </Map>

        {tooltip && (
          <div style={{ ...styles.tooltip, left: tooltip.x + 14, top: tooltip.y + 14 }}>
            <div style={styles.tooltipTitle}>
              {tooltip.info?.country_name ?? tooltip.code}
              {tooltip.info?.label && (
                <span style={{ ...styles.tooltipBadge, color: CATEGORY_COLORS[tooltip.info.label] ?? '#aaa' }}>
                  {tooltip.info.label}
                </span>
              )}
            </div>
            {tooltip.info?.topic && (
              <div style={styles.tooltipTopic}>{tooltip.info.topic}</div>
            )}
            {tooltip.info?.title_en && (
              <div style={styles.tooltipHeadline}>{tooltip.info.title_en}</div>
            )}
          </div>
        )}
      </div>

      {/* Legend — top 4 topics + Other */}
      {topTopics.length > 0 && (
        <div style={styles.legend}>
          {topTopics.map(({ topic, count }) => {
            const color = topicColor(topic, countryData)
            const active = activeLegendTopic === topic
            return (
              <span
                key={topic}
                onClick={() => setActiveLegendTopic(v => v === topic ? null : topic)}
                style={{
                  ...styles.legendItem,
                  background: active ? color : 'transparent',
                  color: active ? '#fff' : color,
                  border: `1px solid ${color}`,
                  opacity: activeLegendTopic && !active ? 0.4 : 1,
                }}
              >
                {topic}
                <span style={styles.legendCount}>{count}</span>
              </span>
            )
          })}
          {(() => {
            const otherCount = Object.values(countryData).filter(
              d => d?.arcGroup && !topTopicSet.has(d.arcGroup)
            ).length
            if (otherCount === 0) return null
            const active = activeLegendTopic === '__other__'
            return (
              <span
                key="__other__"
                onClick={() => setActiveLegendTopic(v => v === '__other__' ? null : '__other__')}
                style={{
                  ...styles.legendItem,
                  background: active ? '#556' : 'transparent',
                  color: active ? '#fff' : '#889',
                  border: '1px solid #445',
                  opacity: activeLegendTopic && !active ? 0.4 : 1,
                }}
              >
                Other
                <span style={styles.legendCount}>{otherCount}</span>
              </span>
            )
          })()}
          {activeLegendTopic && (
            <span
              onClick={() => setActiveLegendTopic(null)}
              style={styles.legendClear}
            >
              ✕ clear
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const styles = {
  wrap: {
    marginBottom: '24px',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid var(--border)',
  },
  mapContainer: {
    position: 'relative',
    width: '100%',
    height: '500px',
    background: '#050a14',
  },
  tooltip: {
    position: 'absolute',
    background: 'rgba(10,18,32,0.95)',
    color: '#e8e8e4',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '0.78rem',
    maxWidth: '260px',
    pointerEvents: 'none',
    boxShadow: '0 2px 20px rgba(0,0,0,0.8)',
    zIndex: 10,
    lineHeight: 1.4,
    border: '1px solid rgba(255,255,255,0.08)',
  },
  tooltipTitle: {
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  tooltipBadge: {
    fontSize: '0.72rem',
    fontWeight: 400,
  },
  tooltipTopic: {
    marginTop: '3px',
    fontSize: '0.75rem',
    opacity: 0.85,
    fontStyle: 'italic',
  },
  tooltipHeadline: {
    marginTop: '4px',
    fontSize: '0.74rem',
    opacity: 0.65,
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    padding: '10px 14px',
    background: '#070d1a',
    borderTop: '1px solid #1a2535',
  },
  legendItem: {
    padding: '3px 9px',
    borderRadius: '4px',
    fontSize: '0.72rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'opacity 0.15s',
    userSelect: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
  },
  legendCount: {
    fontSize: '0.65rem',
    opacity: 0.7,
  },
  legendClear: {
    padding: '3px 9px',
    fontSize: '0.72rem',
    color: 'var(--text-faint)',
    cursor: 'pointer',
    alignSelf: 'center',
    userSelect: 'none',
  },
}

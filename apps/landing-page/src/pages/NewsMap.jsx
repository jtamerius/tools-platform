import { useRef, useState, useMemo } from 'react'
import {
  ComposableMap,
  Geographies,
  Geography,
  Line,
  Sphere,
} from 'react-simple-maps'
import { geoCentroid } from 'd3-geo'

const TOPO_URL =
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

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
const DEFAULT_COLOR = '#334455'

// ISO numeric → alpha-2 for all 96 scraped countries
const ISO_NUM_TO_A2 = {
  12: 'DZ',  32: 'AR',  36: 'AU',  40: 'AT',  50: 'BD',
  56: 'BE',  68: 'BO',  76: 'BR', 100: 'BG', 112: 'BY',
 120: 'CM', 124: 'CA', 144: 'LK', 152: 'CL', 156: 'CN',
 158: 'TW', 170: 'CO', 188: 'CR', 191: 'HR', 192: 'CU',
 203: 'CZ', 208: 'DK', 214: 'DO', 218: 'EC', 222: 'SV',
 231: 'ET', 233: 'EE', 246: 'FI', 250: 'FR', 276: 'DE',
 288: 'GH', 300: 'GR', 320: 'GT', 340: 'HN', 344: 'HK',
 348: 'HU', 356: 'IN', 360: 'ID', 368: 'IQ', 372: 'IE',
 376: 'IL', 380: 'IT', 384: 'CI', 392: 'JP', 400: 'JO',
 404: 'KE', 410: 'KR', 414: 'KW', 422: 'LB', 428: 'LV',
 434: 'LY', 440: 'LT', 442: 'LU', 458: 'MY', 484: 'MX',
 496: 'MN', 504: 'MA', 524: 'NP', 528: 'NL', 554: 'NZ',
 558: 'NI', 566: 'NG', 578: 'NO', 586: 'PK', 591: 'PA',
 600: 'PY', 604: 'PE', 608: 'PH', 616: 'PL', 620: 'PT',
 630: 'PR', 642: 'RO', 643: 'RU', 682: 'SA', 686: 'SN',
 688: 'RS', 702: 'SG', 703: 'SK', 704: 'VN', 705: 'SI',
 710: 'ZA', 724: 'ES', 752: 'SE', 756: 'CH', 764: 'TH',
 784: 'AE', 788: 'TN', 792: 'TR', 800: 'UG', 804: 'UA',
 818: 'EG', 826: 'GB', 834: 'TZ', 840: 'US', 858: 'UY',
 862: 'VE',
}

// Fallback centroids for territories too small for 110m resolution
const FALLBACK_CENTROIDS = {
  HK: [114.18, 22.32],
  SG: [103.82, 1.36],
  PR: [-66.59, 18.22],
}

// Return dominant CATEGORY_COLORS color for a given arcGroup topic
function topicColor(topic, countryData) {
  const counts = {}
  Object.values(countryData).forEach(d => {
    if (d?.arcGroup === topic && d?.label)
      counts[d.label] = (counts[d.label] || 0) + 1
  })
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
  return CATEGORY_COLORS[top] ?? '#aaa'
}

function buildArcPairs(centroidMap, countryData, activeTopic, hoveredCode) {
  if (!activeTopic) return []

  const members = Object.entries(countryData)
    .filter(([code, d]) => d?.arcGroup === activeTopic && centroidMap[code])
    .map(([code]) => code)

  if (members.length < 2) return []

  const pairs = []

  if (hoveredCode && centroidMap[hoveredCode] && countryData[hoveredCode]?.arcGroup === activeTopic) {
    // Star topology from hovered country
    const from = centroidMap[hoveredCode]
    members.forEach(code => {
      if (code !== hoveredCode) pairs.push([from, centroidMap[code], `${hoveredCode}-${code}`])
    })
  } else if (members.length <= 8) {
    // Full mesh for small groups
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++)
        pairs.push([centroidMap[members[i]], centroidMap[members[j]], `${members[i]}-${members[j]}`])
  } else {
    // Star from geographic centroid for large groups
    const lons = members.map(c => centroidMap[c][0])
    const lats = members.map(c => centroidMap[c][1])
    const center = [
      lons.reduce((a, b) => a + b, 0) / lons.length,
      lats.reduce((a, b) => a + b, 0) / lats.length,
    ]
    members.forEach(code => pairs.push([center, centroidMap[code], `center-${code}`]))
  }

  return pairs
}


export default function NewsMap({ countryData = {} }) {
  const containerRef = useRef(null)
  const [hoveredCode, setHoveredCode] = useState(null)
  const [activeLegendTopic, setActiveLegendTopic] = useState(null)
  const [tooltip, setTooltip] = useState(null)

  // Top 4 topics by country count (arcGroup with ≥2 countries), rest → "Other"
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

  // Active topic: legend selection takes priority, then hover
  const hoveredTopic = hoveredCode ? (countryData[hoveredCode]?.arcGroup ?? null) : null
  const activeTopic = activeLegendTopic ?? hoveredTopic

  function handleEnter(a2, info, e) {
    setHoveredCode(a2)
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setTooltip({
      x: e.clientX - rect.left + 14,
      y: e.clientY - rect.top + 14,
      code: a2,
      info,
    })
  }

  function handleLeave() {
    setHoveredCode(null)
    setTooltip(null)
  }

  return (
    <div style={styles.wrap}>
      <div ref={containerRef} style={styles.mapContainer}>
        <ComposableMap
          projection="geoNaturalEarth1"
          width={800}
          height={420}
          style={{ width: '100%', height: 'auto', display: 'block', background: '#0a1628' }}
        >
          <Sphere fill="#0d1f35" stroke="#1a2535" strokeWidth={0.5} />
          <Geographies geography={TOPO_URL}>
            {({ geographies }) => {
              // Build centroid map inline — no setState
              const centroidMap = { ...FALLBACK_CENTROIDS }
              geographies.forEach(geo => {
                const a2 = ISO_NUM_TO_A2[+geo.id]
                if (a2) centroidMap[a2] = geoCentroid(geo)
              })

              const isOther = activeTopic === '__other__'
              const arcPairs = isOther ? [] : buildArcPairs(centroidMap, countryData, activeTopic, hoveredCode)
              const arcColor = activeTopic ? topicColor(activeTopic, countryData) : '#aaa'

              return (
                <>
                  {geographies.map(geo => {
                    const a2 = ISO_NUM_TO_A2[+geo.id]
                    const info = a2 ? (countryData[a2] ?? null) : null
                    const cat = info?.label ?? null
                    const baseColor = cat ? (CATEGORY_COLORS[cat] ?? DEFAULT_COLOR) : DEFAULT_COLOR
                    // Dim countries not matching the active selection
                    const inOther = isOther && info?.arcGroup && !topTopicSet.has(info.arcGroup)
                    const dimmed = activeTopic && (isOther ? !inOther : info?.arcGroup !== activeTopic)

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        style={{
                          default: {
                            fill: baseColor,
                            fillOpacity: dimmed ? 0.18 : (info ? 0.65 : 0.2),
                            stroke: '#1a2030',
                            strokeWidth: 0.3,
                            outline: 'none',
                          },
                          hover: {
                            fill: baseColor,
                            fillOpacity: 0.95,
                            stroke: '#ffffff',
                            strokeWidth: 0.5,
                            outline: 'none',
                          },
                          pressed: { outline: 'none' },
                        }}
                        onMouseEnter={e => a2 && handleEnter(a2, info, e)}
                        onMouseLeave={handleLeave}
                        onMouseMove={e => {
                          if (!containerRef.current || !hoveredCode) return
                          const rect = containerRef.current.getBoundingClientRect()
                          setTooltip(t => t ? { ...t, x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 14 } : t)
                        }}
                      />
                    )
                  })}
                  {arcPairs.map(([from, to, key]) => (
                    <Line
                      key={key}
                      from={from}
                      to={to}
                      stroke={arcColor}
                      strokeWidth={0.9}
                      strokeOpacity={0.55}
                      strokeLinecap="round"
                      style={{ pointerEvents: 'none' }}
                    />
                  ))}
                </>
              )
            }}
          </Geographies>
        </ComposableMap>

        {/* Tooltip */}
        {tooltip && (
          <div style={{ ...styles.tooltip, left: tooltip.x, top: tooltip.y }}>
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
          {/* "Other" entry — countries outside the top 4 topics */}
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
    background: '#050a14',
  },
  tooltip: {
    position: 'absolute',
    background: '#0d1622',
    color: '#e8e8e4',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '0.78rem',
    maxWidth: '240px',
    pointerEvents: 'none',
    boxShadow: '0 2px 16px rgba(0,0,0,0.7)',
    zIndex: 10,
    lineHeight: 1.4,
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
    opacity: 0.7,
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
    fontVariantNumeric: 'tabular-nums',
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

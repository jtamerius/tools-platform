import { useEffect, useState, useRef, useMemo } from 'react'
import NewsMap from './NewsMap'

const S3_URL = 'https://jtamerius-news-data.s3.amazonaws.com/latest.json'
const RECAT_URL = import.meta.env.VITE_NEWS_RECATEGORIZE_API_URL || ''
const FLAG_BASE = 'https://flagcdn.com/20x15'
const PROVIDERS = ['groq', 'gemini', 'huggingface', 'openrouter', 'bedrock']
const LS_PROMPT = 'news-ai-prompt'
const LS_OVERRIDES = 'news-ai-overrides'

const TAXONOMY = [
  'Politics', 'Elections', 'War & Conflict', 'Diplomacy', 'Economy',
  'Energy', 'Environment', 'Crime & Justice', 'Health', 'Natural Disasters',
  'Technology', 'Social Issues', 'Business', 'Sports', 'Science',
]

// ── Data helpers ─────────────────────────────────────────────────────────────

function getCat(country) {
  const cats = country.headlines?.[0]?.categorization
  if (!cats) return null
  for (const p of PROVIDERS) if (cats[p]?.label) return cats[p].label
  return null
}

function getTopic(country) {
  const cats = country.headlines?.[0]?.categorization
  if (!cats) return null
  for (const p of PROVIDERS) if (cats[p]?.topic) return cats[p].topic
  return null
}

function getTitleEn(country) {
  const cats = country.headlines?.[0]?.categorization
  if (!cats) return null
  for (const p of PROVIDERS) if (cats[p]?.title_en) return cats[p].title_en
  return null
}

function formatTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function News() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [prompt, setPrompt] = useState(() => localStorage.getItem(LS_PROMPT) || '')
  const [overrides, setOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_OVERRIDES) || 'null') || {} }
    catch { return {} }
  })
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState(null)

  const [selectedCat, setSelectedCat] = useState('All')
  // Infinity = latest; integer = history index
  const [historyIdx, setHistoryIdx] = useState(Infinity)

  const promptRef = useRef(null)

  useEffect(() => {
    fetch(`${S3_URL}?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(json => { setData(json); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const history = data?.history ?? []
  const isLatest = historyIdx >= history.length

  const allCountries = data?.countries?.filter(c => c.headlines?.length) ?? []
  const runAt = data?.run_metadata?.run_started_at

  // country_code → country_name map (from live data, stable across history)
  const codeToName = useMemo(() => {
    const m = {}
    data?.countries?.forEach(c => { m[c.country_code] = c.country_name })
    return m
  }, [data])

  // Build category list — taxonomy + any custom labels from overrides
  const customCats = [...new Set(Object.values(overrides).filter(v => v && !TAXONOMY.includes(v)))]
  const allCats = ['All', ...TAXONOMY, ...customCats]

  // Annotate live countries with their resolved badge
  const annotated = allCountries.map(c => {
    const aiOverride = isLatest ? (overrides[c.country_code] ?? null) : null
    const display = aiOverride ?? getTopic(c) ?? getCat(c)
    return { ...c, _badge: { display, isAI: !!aiOverride } }
  })

  // ── countryData for the map ──────────────────────────────────────────────
  const mapCountryData = useMemo(() => {
    if (isLatest) {
      const result = {}
      annotated.forEach(c => {
        const code = c.country_code
        const aiLabel = overrides[code] || null
        result[code] = {
          label: aiLabel || getCat(c),
          topic: getTopic(c),
          title_en: getTitleEn(c),
          country_name: c.country_name,
          // arcGroup drives arc connections: AI override label groups user-defined
          // clusters; otherwise use the specific topic so only countries covering
          // the exact same story are connected, not every country in a broad category.
          arcGroup: aiLabel || getTopic(c) || getCat(c),
        }
      })
      return result
    } else {
      const snapshot = history[historyIdx]
      const result = {}
      Object.entries(snapshot?.countries ?? {}).forEach(([code, info]) => {
        result[code] = {
          ...info,
          country_name: codeToName[code] ?? code,
          arcGroup: info.topic || info.label,
        }
      })
      return result
    }
  }, [isLatest, annotated, overrides, history, historyIdx, codeToName])

  // ── Table rows ───────────────────────────────────────────────────────────
  const historicalRows = useMemo(() => {
    if (isLatest) return null
    const snapshot = history[historyIdx]
    return Object.entries(snapshot?.countries ?? {}).map(([code, info]) => ({
      country_code: code,
      country_name: codeToName[code] ?? code,
      ...info,
    }))
  }, [isLatest, history, historyIdx, codeToName])

  // Apply category filter
  const displayRows = isLatest
    ? (selectedCat === 'All'
        ? annotated
        : annotated.filter(c => c._badge.display === selectedCat || getCat(c) === selectedCat))
    : (selectedCat === 'All'
        ? (historicalRows ?? [])
        : (historicalRows ?? []).filter(r => r.label === selectedCat))

  // ── AI recategorize ──────────────────────────────────────────────────────
  async function handleApplyAI() {
    if (!prompt.trim()) return
    if (!RECAT_URL) { setAiError('Recategorize API URL not configured.'); return }
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch(`${RECAT_URL}/recategorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), countries: allCountries }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const { recategorizations } = await res.json()
      setOverrides(recategorizations)
      localStorage.setItem(LS_PROMPT, prompt)
      localStorage.setItem(LS_OVERRIDES, JSON.stringify(recategorizations))
    } catch (err) {
      setAiError(err.message)
    } finally {
      setAiLoading(false)
    }
  }

  async function handleRunScraper() {
    if (!RECAT_URL) return
    setScraping(true)
    setScrapeMsg(null)
    try {
      const res = await fetch(`${RECAT_URL}/run`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setScrapeMsg('Scraper started — refresh in ~5 minutes for fresh data.')
    } catch (err) {
      setScrapeMsg(`Failed to start: ${err.message}`)
    } finally {
      setScraping(false)
    }
  }

  function handleClear() {
    setOverrides({})
    setPrompt('')
    setSelectedCat('All')
    setAiError(null)
    localStorage.removeItem(LS_PROMPT)
    localStorage.removeItem(LS_OVERRIDES)
  }

  const activeOverrides = Object.values(overrides).filter(Boolean).length

  return (
    <main style={styles.main}>
      <div style={styles.header}>
        <h1 style={styles.heading}>Global News</h1>
        {runAt && <span style={styles.meta}>Updated {formatTime(runAt)}</span>}
        {RECAT_URL && (
          <button
            style={scraping ? { ...styles.btnRun, opacity: 0.6, cursor: 'not-allowed' } : styles.btnRun}
            onClick={handleRunScraper}
            disabled={scraping}
          >
            {scraping ? 'Starting…' : '↻ Run Scraper'}
          </button>
        )}
        {scrapeMsg && <span style={styles.scrapeMsg}>{scrapeMsg}</span>}
      </div>

      {/* ── World map ────────────────────────────────────────────────────── */}
      {!loading && !error && (
        <NewsMap countryData={mapCountryData} />
      )}

      {/* ── Time slider ─────────────────────────────────────────────────── */}
      {!loading && !error && history.length > 0 && (
        <div style={styles.sliderRow}>
          <input
            type="range"
            min={0}
            max={history.length}
            value={isLatest ? history.length : historyIdx}
            onChange={e => setHistoryIdx(+e.target.value >= history.length ? Infinity : +e.target.value)}
            style={styles.slider}
          />
          <span style={styles.sliderLabel}>
            {isLatest
              ? <><span style={styles.liveDot} />Live</>
              : formatDate(history[historyIdx]?.run_ts)
            }
          </span>
          {!isLatest && (
            <button style={styles.btnSecondary} onClick={() => setHistoryIdx(Infinity)}>
              Back to live
            </button>
          )}
        </div>
      )}

      {/* ── AI recategorization prompt ───────────────────────────────────── */}
      <div style={styles.aiPanel}>
        <div style={styles.aiInputRow}>
          <input
            ref={promptRef}
            style={styles.aiInput}
            type="text"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleApplyAI()}
            placeholder='e.g. "Iran war"  or  "economic crises"  or  "EU political instability"'
            disabled={aiLoading || !isLatest}
          />
          <button
            style={aiLoading || !isLatest ? { ...styles.btnPrimary, ...styles.btnDisabled } : styles.btnPrimary}
            onClick={handleApplyAI}
            disabled={aiLoading || !prompt.trim() || !isLatest}
          >
            {aiLoading ? 'Thinking…' : 'Apply with AI'}
          </button>
          {activeOverrides > 0 && (
            <button style={styles.btnSecondary} onClick={handleClear}>
              Clear
            </button>
          )}
        </div>
        {activeOverrides > 0 && isLatest && !aiLoading && (
          <p style={styles.aiStatus}>
            {activeOverrides} headline{activeOverrides !== 1 ? 's' : ''} recategorized · saved locally in your browser (not written to S3)
          </p>
        )}
        {aiError && <p style={styles.aiError}>{aiError}</p>}
      </div>

      {/* ── Category filter ──────────────────────────────────────────────── */}
      <div style={styles.filterRow}>
        <select
          style={styles.select}
          value={selectedCat}
          onChange={e => setSelectedCat(e.target.value)}
        >
          {allCats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {!loading && !error && (
          <span style={styles.countLabel}>{displayRows.length} countries</span>
        )}
      </div>

      {loading && <p style={styles.status}>Loading…</p>}
      {error   && <p style={styles.status}>Failed to load: {error}</p>}

      {!loading && !error && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Country</th>
                <th style={styles.th}>Top Headline</th>
                <th style={styles.th}>Category</th>
                {isLatest && <th style={styles.th}>Source</th>}
                {isLatest && <th style={styles.th}>Published</th>}
              </tr>
            </thead>
            <tbody>
              {isLatest
                ? displayRows.map(country => {
                    const headline = country.headlines[0]
                    const { display, isAI } = country._badge
                    return (
                      <tr key={country.country_code} style={styles.row}>
                        <td style={styles.tdCountry}>
                          <img
                            src={`${FLAG_BASE}/${country.country_code.toLowerCase()}.png`}
                            alt={country.country_code}
                            style={styles.flag}
                            onError={e => { e.currentTarget.style.display = 'none' }}
                          />
                          {country.country_name}
                        </td>
                        <td style={styles.td}>
                          {headline.link
                            ? <a href={headline.link} target="_blank" rel="noopener noreferrer" style={styles.link}>{getTitleEn(country) || headline.title}</a>
                            : (getTitleEn(country) || headline.title)}
                        </td>
                        <td style={styles.td}>
                          {display
                            ? <span style={isAI ? styles.badgeAI : styles.badge}>{display}</span>
                            : '—'}
                        </td>
                        <td style={styles.tdMuted}>{headline.source || '—'}</td>
                        <td style={styles.tdMuted}>{formatTime(headline.published)}</td>
                      </tr>
                    )
                  })
                : displayRows.map(row => (
                    <tr key={row.country_code} style={styles.row}>
                      <td style={styles.tdCountry}>
                        <img
                          src={`${FLAG_BASE}/${row.country_code.toLowerCase()}.png`}
                          alt={row.country_code}
                          style={styles.flag}
                          onError={e => { e.currentTarget.style.display = 'none' }}
                        />
                        {row.country_name}
                      </td>
                      <td style={styles.td}>{row.title_en || '—'}</td>
                      <td style={styles.td}>
                        {(row.topic || row.label)
                          ? <span style={styles.badge}>{row.topic || row.label}</span>
                          : '—'}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

const styles = {
  main: {
    flex: 1,
    maxWidth: 'var(--max-w)',
    width: '100%',
    margin: '0 auto',
    padding: '48px 24px 80px',
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  heading: {
    fontSize: '1.6rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
    margin: 0,
  },
  meta: {
    fontSize: '0.75rem',
    color: 'var(--text-faint)',
  },
  btnRun: {
    marginLeft: 'auto',
    padding: '5px 14px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    background: 'none',
    color: 'var(--text-muted)',
    fontSize: '0.8rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  scrapeMsg: {
    fontSize: '0.75rem',
    color: 'var(--text-faint)',
    whiteSpace: 'nowrap',
  },
  // ── Slider
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap',
  },
  slider: {
    flex: 1,
    minWidth: '160px',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  sliderLabel: {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    whiteSpace: 'nowrap',
  },
  liveDot: {
    display: 'inline-block',
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: '#4caf50',
  },
  // ── AI panel
  aiPanel: {
    marginBottom: '16px',
  },
  aiInputRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  aiInput: {
    flex: 1,
    minWidth: '240px',
    padding: '7px 12px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: '0.85rem',
  },
  btnPrimary: {
    padding: '7px 18px',
    borderRadius: '6px',
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: '0.82rem',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  btnSecondary: {
    padding: '7px 14px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    background: 'none',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  aiStatus: {
    margin: '6px 0 0',
    fontSize: '0.75rem',
    color: 'var(--text-faint)',
  },
  aiError: {
    margin: '6px 0 0',
    fontSize: '0.78rem',
    color: '#e05',
  },
  // ── Filter row
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
  },
  select: {
    padding: '5px 10px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: '0.82rem',
    cursor: 'pointer',
  },
  countLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-faint)',
  },
  // ── Table
  status: {
    color: 'var(--text-muted)',
    fontSize: '0.9rem',
  },
  tableWrap: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.85rem',
  },
  th: {
    textAlign: 'left',
    padding: '8px 12px',
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  row: {
    borderBottom: '1px solid var(--border-subtle)',
  },
  td: {
    padding: '10px 12px',
    color: 'var(--text)',
    verticalAlign: 'top',
    maxWidth: '380px',
  },
  tdCountry: {
    padding: '10px 12px',
    color: 'var(--text)',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  tdMuted: {
    padding: '10px 12px',
    color: 'var(--text-muted)',
    verticalAlign: 'top',
    whiteSpace: 'nowrap',
    fontSize: '0.8rem',
  },
  flag: {
    display: 'inline-block',
    verticalAlign: 'middle',
    borderRadius: '2px',
  },
  link: {
    color: 'var(--accent)',
    textDecoration: 'none',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    background: 'var(--border-subtle)',
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    whiteSpace: 'nowrap',
  },
  badgeAI: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
    color: 'var(--accent)',
    fontSize: '0.75rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
}

import { useEffect, useState, useRef } from 'react'

const S3_URL = 'https://jtamerius-news-data.s3.amazonaws.com/latest.json'
const RECAT_URL = import.meta.env.VITE_NEWS_RECATEGORIZE_API_URL || ''
const FLAG_BASE = 'https://flagcdn.com/20x15'
const PROVIDERS = ['groq', 'gemini', 'huggingface', 'openrouter']
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function News() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [prompt, setPrompt] = useState(() => localStorage.getItem(LS_PROMPT) || '')
  // overrides: { [country_code]: string | null }
  const [overrides, setOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_OVERRIDES) || 'null') || {} }
    catch { return {} }
  })
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(null)

  const [selectedCat, setSelectedCat] = useState('All')
  const promptRef = useRef(null)

  useEffect(() => {
    fetch(`${S3_URL}?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(json => { setData(json); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const allCountries = data?.countries?.filter(c => c.headlines?.length) ?? []
  const runAt = data?.run_metadata?.run_started_at

  // Build category list — taxonomy + any custom labels from overrides
  const customCats = [...new Set(Object.values(overrides).filter(v => v && !TAXONOMY.includes(v)))]
  const allCats = ['All', ...TAXONOMY, ...customCats]

  // Annotate countries with their resolved badge
  const annotated = allCountries.map(c => {
    const aiOverride = overrides[c.country_code] ?? null
    const display = aiOverride ?? getTopic(c) ?? getCat(c)
    return { ...c, _badge: { display, isAI: !!aiOverride } }
  })

  // Apply category filter
  const countries = selectedCat === 'All'
    ? annotated
    : annotated.filter(c =>
        c._badge.display === selectedCat ||
        getCat(c) === selectedCat
      )

  async function handleApplyAI() {
    if (!prompt.trim()) return
    if (!RECAT_URL) {
      setAiError('Recategorize API URL not configured.')
      return
    }
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
      </div>

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
            disabled={aiLoading}
          />
          <button
            style={aiLoading ? { ...styles.btnPrimary, ...styles.btnDisabled } : styles.btnPrimary}
            onClick={handleApplyAI}
            disabled={aiLoading || !prompt.trim()}
          >
            {aiLoading ? 'Thinking…' : 'Apply with AI'}
          </button>
          {activeOverrides > 0 && (
            <button style={styles.btnSecondary} onClick={handleClear}>
              Clear
            </button>
          )}
        </div>
        {activeOverrides > 0 && !aiLoading && (
          <p style={styles.aiStatus}>
            {activeOverrides} headline{activeOverrides !== 1 ? 's' : ''} recategorized
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
          <span style={styles.countLabel}>{countries.length} countries</span>
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
                <th style={styles.th}>Source</th>
                <th style={styles.th}>Published</th>
              </tr>
            </thead>
            <tbody>
              {countries.map(country => {
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
              })}
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

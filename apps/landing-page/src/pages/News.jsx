import { useEffect, useState } from 'react'

const S3_URL = 'https://jtamerius-news-data.s3.amazonaws.com/latest.json'
const FLAG_BASE = 'https://flagcdn.com/20x15'
const PROVIDERS = ['groq', 'gemini', 'huggingface', 'openrouter']
const LS_KEY = 'news-custom-rules'

const TAXONOMY = [
  'Politics', 'Elections', 'War & Conflict', 'Diplomacy', 'Economy',
  'Energy', 'Environment', 'Crime & Justice', 'Health', 'Natural Disasters',
  'Technology', 'Social Issues', 'Business', 'Sports', 'Science',
]

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function getSearchText(country) {
  const h = country.headlines?.[0]
  return [
    getTitleEn(country) || '',
    getTopic(country) || '',
    h?.title || '',
    (() => {
      const cats = h?.categorization
      if (!cats) return ''
      for (const p of PROVIDERS) if (cats[p]?.summary) return cats[p].summary
      return ''
    })(),
  ].join(' ').toLowerCase()
}

function parseRules(text) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && (l.includes('→') || l.includes('->')))
    .map(l => {
      const sep = l.includes('→') ? '→' : '->'
      const [left, right] = l.split(sep).map(s => s.trim())
      return {
        keywords: left.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
        category: right || '',
      }
    })
    .filter(r => r.keywords.length > 0 && r.category)
}

function matchRule(country, rules) {
  if (!rules.length) return null
  const text = getSearchText(country)
  for (const rule of rules) {
    if (rule.keywords.some(kw => text.includes(kw))) return rule.category
  }
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

  const [rulesText, setRulesText] = useState(() => localStorage.getItem(LS_KEY) || '')
  const [rules, setRules] = useState(() => parseRules(localStorage.getItem(LS_KEY) || ''))
  const [rulesOpen, setRulesOpen] = useState(false)
  const [selectedCat, setSelectedCat] = useState('All')

  useEffect(() => {
    fetch(`${S3_URL}?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(json => { setData(json); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const allCountries = data?.countries?.filter(c => c.headlines?.length) ?? []
  const runAt = data?.run_metadata?.run_started_at

  // Build full category list: taxonomy + any extra custom categories from rules
  const customCats = rules.map(r => r.category).filter(c => !TAXONOMY.includes(c))
  const allCats = ['All', ...TAXONOMY, ...customCats]

  // Annotate each country with its resolved badge
  const annotated = allCountries.map(c => {
    const custom = matchRule(c, rules)
    const display = custom ?? getTopic(c) ?? getCat(c)
    return { ...c, _badge: { display, isCustom: !!custom } }
  })

  // Filter by selected category
  const countries = selectedCat === 'All'
    ? annotated
    : annotated.filter(c => c._badge.display === selectedCat || getCat(c) === selectedCat)

  function applyRules() {
    const parsed = parseRules(rulesText)
    setRules(parsed)
    localStorage.setItem(LS_KEY, rulesText)
  }

  function clearRules() {
    setRulesText('')
    setRules([])
    localStorage.removeItem(LS_KEY)
    setSelectedCat('All')
  }

  return (
    <main style={styles.main}>
      <div style={styles.header}>
        <h1 style={styles.heading}>Global News</h1>
        {runAt && <span style={styles.meta}>Updated {formatTime(runAt)}</span>}
      </div>

      {/* ── Custom rules panel ──────────────────────────────────────────── */}
      <div style={styles.rulesWrap}>
        <button style={styles.rulesToggle} onClick={() => setRulesOpen(o => !o)}>
          {rulesOpen ? '▾' : '▸'} Custom Rules
          {rules.length > 0 && <span style={styles.rulesBadge}>{rules.length} active</span>}
        </button>
        {rulesOpen && (
          <div style={styles.rulesPanel}>
            <p style={styles.rulesHint}>
              One rule per line: <code style={styles.code}>keyword1, keyword2 → Category Name</code>
              <br />
              Matches against the headline text. Use <code style={styles.code}>#</code> for comments.
            </p>
            <textarea
              style={styles.rulesTextarea}
              value={rulesText}
              onChange={e => setRulesText(e.target.value)}
              placeholder={'Iran, US-Iran, Strait of Hormuz → Iran-US War\nTrump, White House → US Politics\nGaza, Hamas, Netanyahu → Gaza Conflict'}
              spellCheck={false}
            />
            <div style={styles.rulesActions}>
              <button style={styles.btnPrimary} onClick={applyRules}>Apply</button>
              <button style={styles.btnSecondary} onClick={clearRules}>Clear</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Category filter ─────────────────────────────────────────────── */}
      <div style={styles.filterRow}>
        <select
          style={styles.select}
          value={selectedCat}
          onChange={e => setSelectedCat(e.target.value)}
        >
          {allCats.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {!loading && !error && (
          <span style={styles.countLabel}>{countries.length} countries</span>
        )}
      </div>

      {loading && <p style={styles.status}>Loading…</p>}
      {error && <p style={styles.status}>Failed to load: {error}</p>}

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
                const { display, isCustom } = country._badge
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
                        ? <span style={isCustom ? styles.badgeCustom : styles.badge}>{display}</span>
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
  // ── Rules panel
  rulesWrap: {
    marginBottom: '16px',
  },
  rulesToggle: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '4px 12px',
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  rulesBadge: {
    background: 'var(--accent)',
    color: '#fff',
    borderRadius: '10px',
    padding: '1px 7px',
    fontSize: '0.7rem',
    fontWeight: 600,
  },
  rulesPanel: {
    marginTop: '8px',
    padding: '16px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--surface, var(--bg))',
  },
  rulesHint: {
    margin: '0 0 10px',
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: '0.78rem',
    background: 'var(--border-subtle)',
    padding: '1px 5px',
    borderRadius: '3px',
  },
  rulesTextarea: {
    width: '100%',
    minHeight: '90px',
    fontFamily: 'monospace',
    fontSize: '0.82rem',
    padding: '8px 10px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--bg)',
    color: 'var(--text)',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  rulesActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '8px',
  },
  btnPrimary: {
    padding: '5px 16px',
    borderRadius: '6px',
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: '0.82rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '5px 16px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    background: 'none',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
    cursor: 'pointer',
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
  badgeCustom: {
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

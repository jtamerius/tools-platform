import { useEffect, useState } from 'react'

const S3_URL = 'https://jtamerius-news-data.s3.amazonaws.com/latest.json'

const FLAG_BASE = 'https://flagcdn.com/20x15'

const PROVIDERS = ['groq', 'gemini', 'huggingface', 'openrouter']

// Pick the first available LLM label from the categories dict
function getLabel(country) {
  const cats = country.categories
  if (!cats) return null
  for (const provider of PROVIDERS) {
    if (cats[provider]?.label) return cats[provider].label
  }
  return null
}

// Pick the first available English translation
function getTitleEn(country) {
  const cats = country.categories
  if (!cats) return null
  for (const provider of PROVIDERS) {
    if (cats[provider]?.title_en) return cats[provider].title_en
  }
  return null
}

function formatTime(isoString) {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

export default function News() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(S3_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(json => { setData(json); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const countries = data?.countries?.filter(c => c.headlines?.length) ?? []
  const runAt = data?.run_metadata?.run_started_at

  return (
    <main style={styles.main}>
      <div style={styles.header}>
        <h1 style={styles.heading}>Global News</h1>
        {runAt && (
          <span style={styles.meta}>Updated {formatTime(runAt)}</span>
        )}
      </div>

      {loading && <p style={styles.status}>Loading…</p>}
      {error && <p style={styles.error}>Failed to load: {error}</p>}

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
                const label = getLabel(country)
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
                      {label ? <span style={styles.badge}>{label}</span> : '—'}
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
    marginBottom: '32px',
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
  status: {
    color: 'var(--text-muted)',
    fontSize: '0.9rem',
  },
  error: {
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
}

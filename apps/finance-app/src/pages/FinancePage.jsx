import { useEffect, useState, useCallback } from 'react'

const API_URL = 'https://uvt928vggh.execute-api.us-east-1.amazonaws.com'

async function apiFetch(path, getAccessToken) {
  const token = await getAccessToken()
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) {
    const msg = data.error || data.message || data.Message || 'Request failed'
    throw Object.assign(new Error(`${res.status}: ${msg}`), { status: res.status })
  }
  return data
}

const fmt = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export default function FinancePage({ getAccessToken }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)
  const [investments, setInvestments] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sum, invs] = await Promise.all([
        apiFetch('/summary', getAccessToken),
        apiFetch('/investments', getAccessToken),
      ])
      setSummary(sum)
      setInvestments(invs)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [getAccessToken])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <div style={s.center}><span style={s.muted}>Loading…</span></div>
  }

  if (error) {
    return (
      <div style={s.center}>
        <p style={s.err}>{error}</p>
        <button style={s.retryBtn} onClick={load}>Retry</button>
      </div>
    )
  }

  return (
    <main style={s.main}>
      <div style={s.cards}>
        <SummaryCard label="Active Investments" value={summary.active_count} />
        <SummaryCard label="Total Principal" value={fmt(summary.total_principal)} />
        <SummaryCard label="Projected Annual" value={fmt(summary.projected_annual)} />
        <SummaryCard label="Projected Monthly" value={fmt(summary.projected_monthly)} />
      </div>

      <h2 style={s.sectionTitle}>Active Investments</h2>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['Project', 'Address', 'Principal', 'Rate', 'Annual', 'Monthly', 'Started'].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {investments.map(inv => (
              <tr key={inv.id} style={s.row}>
                <td style={s.td}>{inv.project_name}</td>
                <td style={s.td}>{inv.address}</td>
                <td style={{ ...s.td, ...s.num }}>{fmt(inv.principal_outstanding)}</td>
                <td style={{ ...s.td, ...s.num }}>{(inv.current_rate * 100).toFixed(1)}%</td>
                <td style={{ ...s.td, ...s.num }}>{fmt(inv.projected_annual)}</td>
                <td style={{ ...s.td, ...s.num }}>{fmt(inv.projected_monthly)}</td>
                <td style={s.td}>{inv.start_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function SummaryCard({ label, value }) {
  return (
    <div style={s.card}>
      <span style={s.cardLabel}>{label}</span>
      <span style={s.cardValue}>{value}</span>
    </div>
  )
}

const s = {
  main: {
    flex: 1,
    maxWidth: 'var(--max-w)',
    width: '100%',
    margin: '0 auto',
    padding: '40px 24px 80px',
  },
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 40,
  },
  muted: { color: 'var(--text-muted)', fontSize: '0.9rem' },
  err: { color: 'var(--red, #f87171)', fontSize: '0.9rem', margin: 0 },
  retryBtn: {
    padding: '6px 16px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '0.875rem',
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 16,
    marginBottom: 40,
  },
  card: {
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #333)',
    borderRadius: 10,
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  cardLabel: {
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--text-faint, #888)',
  },
  cardValue: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: 'var(--text, #e0e0e0)',
    letterSpacing: '-0.02em',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--text)',
    marginBottom: 16,
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid var(--border, #333)',
    borderRadius: 10,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem',
  },
  th: {
    textAlign: 'left',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border, #333)',
    color: 'var(--text-faint, #888)',
    fontWeight: 600,
    fontSize: '0.75rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  row: {},
  td: {
    padding: '12px 14px',
    borderBottom: '1px solid var(--border-subtle, #2a2a3a)',
    color: 'var(--text, #e0e0e0)',
    whiteSpace: 'nowrap',
  },
  num: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
}

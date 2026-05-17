import { useEffect, useState, lazy, Suspense } from 'react'
import RecordPanel from '../components/RecordPanel'
import FilterBar from '../components/FilterBar'
import DashboardPage from './DashboardPage'
import { useReviewApi } from '../hooks/useReviewApi'

const AnnotatePage = lazy(() => import('./AnnotatePage'))

const styles = {
  page: { flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12, maxWidth: 1400, margin: '0 auto', width: '100%' },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' },
  tab: (active) => ({
    padding: '8px 16px',
    background: 'transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
  }),
  empty: { padding: 40, textAlign: 'center', color: 'var(--text-muted)' },
}

export default function ReviewPage({ getAccessToken }) {
  const api = useReviewApi(getAccessToken)
  const [mode, setMode] = useState('queue')
  const [filters, setFilters] = useState({})
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    if (mode === 'dashboard' || mode === 'annotate') return
    let cancelled = false
    setLoading(true)
    setError(null)
    const fetcher = mode === 'queue' ? api.fetchQueue : api.fetchSearch
    fetcher(filters).then((rs) => {
      if (cancelled) return
      setRecords(rs)
      setCursor(0)
    }).catch((e) => {
      if (cancelled) return
      setError(e.message)
    }).finally(() => {
      if (cancelled) return
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [mode, filters, api])

  const current = records[cursor]

  const decide = async (decision) => {
    if (!current) return
    await api.submitDecision(current.pk, current.sk, decision)
    setRecords(rs => rs.filter((_, i) => i !== cursor))
    setCursor(c => Math.min(c, Math.max(0, records.length - 2)))
  }

  return (
    <div style={styles.page}>
      <div style={styles.tabs}>
        <button style={styles.tab(mode === 'queue')} onClick={() => setMode('queue')}>Queue</button>
        <button style={styles.tab(mode === 'search')} onClick={() => setMode('search')}>Search</button>
        <button style={styles.tab(mode === 'dashboard')} onClick={() => setMode('dashboard')}>Dashboard</button>
        <button style={styles.tab(mode === 'annotate')} onClick={() => setMode('annotate')}>Annotate</button>
      </div>

      {mode === 'dashboard' && <DashboardPage api={api} />}
      {mode === 'annotate' && (
        <Suspense fallback={<div style={styles.empty}>Loading…</div>}>
          <AnnotatePage api={api} />
        </Suspense>
      )}

      {mode !== 'dashboard' && mode !== 'annotate' && (
        <>
          {mode === 'search' && <FilterBar filters={filters} onChange={setFilters} />}

          {error && <div style={{ color: 'var(--red)' }}>Error: {error}</div>}
          {loading && <div style={styles.empty}>Loading…</div>}

          {!loading && !current && (
            <div style={styles.empty}>
              {mode === 'queue' ? 'Queue empty — nothing to review.' : 'No records match.'}
            </div>
          )}

          {current && (
            <RecordPanel
              record={current}
              api={api}
              onDecide={decide}
              onNext={() => setCursor(c => Math.min(c + 1, records.length - 1))}
              onPrev={() => setCursor(c => Math.max(c - 1, 0))}
              index={cursor}
              total={records.length}
            />
          )}
        </>
      )}
    </div>
  )
}

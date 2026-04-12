import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@tools/auth'

const AUTH_CONFIG = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
  clientId:   import.meta.env.VITE_COGNITO_CLIENT_ID   ?? '',
}

const API_BASE = (import.meta.env.VITE_MARITIME_API_URL ?? '').replace(/\/$/, '')

export default function App() {
  const { user, groups, isLoading, signIn, signOut } = useAuth(AUTH_CONFIG)

  // ── Sign-in form state ──────────────────────────────────────────────────────
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [authError, setAuthError] = useState(null)
  const [signingIn, setSigningIn] = useState(false)

  // ── Dataset browser state ───────────────────────────────────────────────────
  const [datasetGroups,  setDatasetGroups]  = useState([])
  const [selectedGroup,  setSelectedGroup]  = useState('')
  const [tableData,      setTableData]      = useState(null)
  const [groupsLoading,  setGroupsLoading]  = useState(false)
  const [dataLoading,    setDataLoading]    = useState(false)
  const [fetchError,     setFetchError]     = useState(null)

  const isMember = groups.includes('member') || groups.includes('admin')

  // Fetch the list of available vessel-group partitions once authenticated.
  useEffect(() => {
    if (!user || !isMember || !API_BASE) return

    setGroupsLoading(true)
    setFetchError(null)

    fetch(`${API_BASE}/datasets`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        const groups = data.groups ?? []
        setDatasetGroups(groups)
        if (groups.length) setSelectedGroup(groups[0])
      })
      .catch((e) => setFetchError(`Could not load dataset list: ${e.message}`))
      .finally(() => setGroupsLoading(false))
  }, [user, isMember]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadDataset = useCallback(async () => {
    if (!selectedGroup) return
    setDataLoading(true)
    setFetchError(null)
    setTableData(null)

    try {
      const r = await fetch(`${API_BASE}/datasets/${encodeURIComponent(selectedGroup)}?limit=100`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
      setTableData(data)
    } catch (e) {
      setFetchError(`Could not load dataset: ${e.message}`)
    } finally {
      setDataLoading(false)
    }
  }, [selectedGroup])

  async function handleSignIn(e) {
    e.preventDefault()
    setSigningIn(true)
    setAuthError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setAuthError(err.message ?? 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }

  // ── Loading splash ──────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={s.centered}><span style={s.faint}>Loading…</span></div>
  }

  // ── Sign-in gate ────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div style={s.centered}>
        <form onSubmit={handleSignIn} style={s.form}>
          <h1 style={s.formTitle}>Maritime Trajectory</h1>
          <p style={s.formSub}>Sign in to browse vessel data</p>

          {authError && <p style={s.errorBox}>{authError}</p>}

          <input
            style={s.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            style={s.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <button style={s.btn} type="submit" disabled={signingIn}>
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    )
  }

  // ── Access denied ───────────────────────────────────────────────────────────
  if (!isMember) {
    return (
      <div style={s.centered}>
        <p style={s.faint}>
          Access requires the <strong>member</strong> Cognito group.
          Contact an admin to request access.
        </p>
        <button style={{ ...s.btnOutline, marginTop: 16 }} onClick={signOut}>
          Sign out
        </button>
      </div>
    )
  }

  // ── Main view ───────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      {/* Header */}
      <header style={s.header}>
        <span style={s.headerTitle}>Maritime Trajectory</span>
        <div style={s.headerRight}>
          <span style={s.userEmail}>{user.email}</span>
          <button style={s.btnOutline} onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main style={s.main}>
        {/* Dataset picker */}
        <section style={s.card}>
          <h2 style={s.sectionTitle}>Maritime Master Record</h2>
          <p style={s.sectionSub}>
            Select a vessel group partition to preview up to 100 rows from the
            processed AIS dataset.
          </p>

          <div style={s.controlRow}>
            <div style={s.fieldGroup}>
              <label htmlFor="group-select" style={s.label}>Vessel Group</label>
              <select
                id="group-select"
                style={s.select}
                value={selectedGroup}
                onChange={(e) => {
                  setSelectedGroup(e.target.value)
                  setTableData(null)
                  setFetchError(null)
                }}
                disabled={groupsLoading || dataLoading}
              >
                {groupsLoading
                  ? <option>Loading partitions…</option>
                  : datasetGroups.length === 0
                    ? <option value="">No partitions found — run the pipeline first</option>
                    : datasetGroups.map((g) => <option key={g} value={g}>{g}</option>)
                }
              </select>
            </div>

            <button
              style={{
                ...s.btn,
                alignSelf: 'flex-end',
                opacity: (!selectedGroup || dataLoading) ? 0.5 : 1,
              }}
              onClick={loadDataset}
              disabled={!selectedGroup || dataLoading || groupsLoading}
            >
              {dataLoading ? 'Loading…' : 'Load dataset'}
            </button>
          </div>

          {fetchError && <p style={s.errorBox}>{fetchError}</p>}
        </section>

        {/* Data table */}
        {tableData && (
          <section style={s.tableSection}>
            <div style={s.tableMeta}>
              <span style={s.tableMetaText}>
                <strong>{tableData.group}</strong> — {tableData.count} row{tableData.count !== 1 ? 's' : ''}
              </span>
              <span style={s.tableMetaText}>
                {tableData.columns.length} column{tableData.columns.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    {tableData.columns.map((col) => (
                      <th key={col} style={s.th}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.rows.map((row, i) => (
                    <tr key={i} style={i % 2 === 0 ? s.rowEven : {}}>
                      {tableData.columns.map((col) => (
                        <td key={col} style={s.td}>
                          {row[col] === null || row[col] === undefined ? (
                            <span style={s.nullVal}>—</span>
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  centered: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: 24,
    background: 'var(--bg)',
  },
  faint: {
    fontSize: '0.9rem',
    color: 'var(--text-faint)',
    textAlign: 'center',
    maxWidth: 360,
    lineHeight: 1.6,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
    maxWidth: 360,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 32,
  },
  formTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
    marginBottom: 2,
  },
  formSub: {
    fontSize: '0.875rem',
    color: 'var(--text-muted)',
    marginBottom: 4,
  },
  input: {
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.9rem',
    fontFamily: 'inherit',
    outline: 'none',
    background: 'var(--bg)',
    color: 'var(--text)',
  },
  btn: {
    padding: '10px 18px',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap',
  },
  btnOutline: {
    padding: '6px 12px',
    background: 'transparent',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.8rem',
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  errorBox: {
    fontSize: '0.85rem',
    color: '#b91c1c',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 'var(--radius)',
    padding: '8px 12px',
    lineHeight: 1.5,
  },
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
  },
  header: {
    height: 'var(--nav-height)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  userEmail: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  main: {
    flex: 1,
    maxWidth: 'var(--max-w)',
    width: '100%',
    margin: '0 auto',
    padding: '40px 24px 80px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '28px 28px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  sectionSub: {
    fontSize: '0.875rem',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    marginTop: -8,
  },
  controlRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 12,
    flexWrap: 'wrap',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text-muted)',
  },
  select: {
    padding: '9px 12px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
    fontFamily: 'inherit',
    background: 'var(--surface)',
    color: 'var(--text)',
    minWidth: 200,
    cursor: 'pointer',
    outline: 'none',
  },
  tableSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  tableMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tableMetaText: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--surface)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.8rem',
    whiteSpace: 'nowrap',
  },
  th: {
    padding: '10px 14px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg)',
  },
  td: {
    padding: '8px 14px',
    borderBottom: '1px solid var(--border-subtle)',
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowEven: {
    background: '#fafaf9',
  },
  nullVal: {
    color: 'var(--text-faint)',
  },
}

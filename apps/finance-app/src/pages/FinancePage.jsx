import { useEffect, useState, useCallback } from 'react'

const API_URL = 'https://uvt928vggh.execute-api.us-east-1.amazonaws.com'

async function apiFetch(path, getAccessToken, options = {}) {
  const token = await getAccessToken()
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
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
const fmtDate = d =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const pct = r => (r * 100).toFixed(1) + '%'
const today = () => new Date().toISOString().slice(0, 10)

const EVENT_LABELS = {
  initial_funding: 'Initial Funding',
  additional_funding: 'Additional Funding',
  principal_reduction: 'Principal Reduction',
  closure_payoff: 'Payoff / Closure',
  rate_change: 'Rate Change',
  status_change: 'Status Change',
}

// ─── Modal (bottom sheet) ──────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div style={ms.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={ms.sheet}>
        <div style={ms.header}>
          <span style={ms.title}>{title}</span>
          <button style={ms.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={ms.body}>{children}</div>
      </div>
    </div>
  )
}

const ms = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 300,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
  },
  sheet: {
    background: 'var(--surface)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '88vh',
    display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px 14px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  title: { fontSize: '1rem', fontWeight: 600, color: 'var(--text)' },
  closeBtn: {
    background: 'none', border: 'none', fontSize: '1.1rem',
    color: 'var(--text-muted)', cursor: 'pointer', padding: 4, lineHeight: 1,
  },
  body: { padding: '16px 20px 40px', overflowY: 'auto' },
}

// ─── Form primitives ───────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inp = {
  width: '100%', padding: '11px 12px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--text)', fontSize: '0.95rem', fontFamily: 'inherit',
}

const primaryBtn = {
  width: '100%', padding: '13px', borderRadius: 10,
  background: 'var(--text)', color: 'var(--bg)',
  border: 'none', fontSize: '0.95rem', fontWeight: 600,
  marginTop: 8, cursor: 'pointer',
}

function FormError({ msg }) {
  return msg ? <p style={{ color: '#e53e3e', fontSize: '0.84rem', marginBottom: 8 }}>{msg}</p> : null
}

// ─── Add Investment ────────────────────────────────────────────────────────

function AddInvestmentForm({ onSave, onClose }) {
  const [f, setF] = useState({ project_name: '', address: '', original_funded_amount: '', start_date: today(), annual_rate: '12', notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      await onSave({ ...f, original_funded_amount: parseFloat(f.original_funded_amount), annual_rate: parseFloat(f.annual_rate) / 100 })
      onClose()
    } catch (ex) { setErr(ex.message); setSaving(false) }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Project / Borrower"><input required style={inp} value={f.project_name} onChange={set('project_name')} placeholder="Pablo Rojo" /></Field>
      <Field label="Address"><input style={inp} value={f.address} onChange={set('address')} placeholder="123 Main St, Tucson" /></Field>
      <Field label="Amount ($)"><input required type="number" min="0" style={inp} value={f.original_funded_amount} onChange={set('original_funded_amount')} placeholder="65000" /></Field>
      <Field label="Start Date"><input required type="date" style={inp} value={f.start_date} onChange={set('start_date')} /></Field>
      <Field label="Annual Rate (%)"><input required type="number" step="0.1" min="0" style={inp} value={f.annual_rate} onChange={set('annual_rate')} placeholder="12" /></Field>
      <Field label="Notes"><textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={f.notes} onChange={set('notes')} /></Field>
      <FormError msg={err} />
      <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Add Investment'}</button>
    </form>
  )
}

// ─── Add Event ─────────────────────────────────────────────────────────────

function AddEventForm({ investmentId, onSave, onClose }) {
  const [f, setF] = useState({ event_type: 'additional_funding', effective_date: today(), amount: '', rate: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))
  const needsAmount = ['additional_funding', 'principal_reduction', 'closure_payoff'].includes(f.event_type)
  const needsRate = f.event_type === 'rate_change'

  async function submit(e) {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      const body = { investment_id: investmentId, event_type: f.event_type, effective_date: f.effective_date, notes: f.notes }
      if (needsAmount) body.amount = parseFloat(f.amount)
      if (needsRate) body.rate = parseFloat(f.rate) / 100
      await onSave(body)
      onClose()
    } catch (ex) { setErr(ex.message); setSaving(false) }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Event Type">
        <select style={inp} value={f.event_type} onChange={set('event_type')}>
          <option value="additional_funding">Additional Funding</option>
          <option value="principal_reduction">Principal Reduction</option>
          <option value="closure_payoff">Payoff / Closure</option>
          <option value="rate_change">Rate Change</option>
        </select>
      </Field>
      <Field label="Effective Date"><input required type="date" style={inp} value={f.effective_date} onChange={set('effective_date')} /></Field>
      {needsAmount && <Field label="Amount ($)"><input required type="number" min="0" style={inp} value={f.amount} onChange={set('amount')} placeholder="10000" /></Field>}
      {needsRate && <Field label="New Rate (%)"><input required type="number" step="0.1" min="0" style={inp} value={f.rate} onChange={set('rate')} placeholder="11.5" /></Field>}
      <Field label="Notes"><textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={f.notes} onChange={set('notes')} /></Field>
      <FormError msg={err} />
      <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Add Event'}</button>
    </form>
  )
}

// ─── Add Account ───────────────────────────────────────────────────────────

function AddAccountForm({ onSave, onClose }) {
  const [f, setF] = useState({ name: '', type: 'bank', notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault(); setSaving(true); setErr('')
    try { await onSave(f); onClose() }
    catch (ex) { setErr(ex.message); setSaving(false) }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Name"><input required style={inp} value={f.name} onChange={set('name')} placeholder="Apple, USAA, 401k…" /></Field>
      <Field label="Type">
        <select style={inp} value={f.type} onChange={set('type')}>
          <option value="bank">Bank</option>
          <option value="investment">Investment</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Notes"><input style={inp} value={f.notes} onChange={set('notes')} /></Field>
      <FormError msg={err} />
      <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Add Account'}</button>
    </form>
  )
}

// ─── Add Snapshot ──────────────────────────────────────────────────────────

function AddSnapshotForm({ accounts, initialAccountId, onSave, onClose }) {
  const [f, setF] = useState({ account_id: initialAccountId || accounts[0]?.id || '', snapshot_date: today(), balance: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault(); setSaving(true); setErr('')
    try { await onSave({ ...f, balance: parseFloat(f.balance) }); onClose() }
    catch (ex) { setErr(ex.message); setSaving(false) }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Account">
        <select style={inp} value={f.account_id} onChange={set('account_id')}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Date"><input required type="date" style={inp} value={f.snapshot_date} onChange={set('snapshot_date')} /></Field>
      <Field label="Balance ($)"><input required type="number" min="0" style={inp} value={f.balance} onChange={set('balance')} placeholder="100000" /></Field>
      <Field label="Note"><input style={inp} value={f.note} onChange={set('note')} /></Field>
      <FormError msg={err} />
      <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save Snapshot'}</button>
    </form>
  )
}

// ─── Investment Card ───────────────────────────────────────────────────────

function InvestmentCard({ inv, expanded, onToggle, onAddEvent }) {
  return (
    <div style={card.wrap}>
      <button style={card.row} onClick={onToggle}>
        <div style={card.left}>
          <div style={card.name}>{inv.project_name}</div>
          <div style={card.sub}>{inv.address || '—'}</div>
        </div>
        <div style={card.right}>
          <div style={card.amount}>{fmt(inv.principal_outstanding)}</div>
          <div style={card.detail}>{fmt(inv.projected_monthly)}/mo · {pct(inv.current_rate)}</div>
        </div>
      </button>

      {expanded && (
        <div style={card.body}>
          <div style={card.metaRow}>
            <span>Started {fmtDate(inv.start_date)}</span>
            <span>{fmt(inv.projected_annual)}/yr</span>
          </div>

          {inv.events?.length > 0 && (
            <div style={card.evtList}>
              {[...inv.events].reverse().map(evt => (
                <div key={evt.id} style={card.evt}>
                  <div style={card.evtTop}>
                    <span style={card.evtType}>{EVENT_LABELS[evt.event_type] || evt.event_type}</span>
                    <span style={card.evtDate}>{fmtDate(evt.effective_date)}</span>
                  </div>
                  {(evt.amount != null || evt.rate != null) && (
                    <div style={card.evtAmount}>
                      {evt.amount != null && fmt(evt.amount)}
                      {evt.rate != null && pct(evt.rate)}
                    </div>
                  )}
                  {evt.notes && <div style={card.evtNotes}>{evt.notes}</div>}
                </div>
              ))}
            </div>
          )}

          <button style={card.addBtn} onClick={onAddEvent}>+ Add Event</button>
        </div>
      )}
    </div>
  )
}

// ─── Account Card ──────────────────────────────────────────────────────────

function AccountCard({ account, snapshots, expanded, onToggle, onAddSnapshot }) {
  const mySnaps = snapshots
    .filter(s => s.account_id === account.id)
    .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))

  return (
    <div style={card.wrap}>
      <button style={card.row} onClick={onToggle}>
        <div style={card.left}>
          <div style={card.name}>{account.name}</div>
          <div style={card.sub}>{account.type}</div>
        </div>
        <div style={card.right}>
          <div style={card.amount}>{account.latest_balance != null ? fmt(account.latest_balance) : '—'}</div>
          {account.latest_snapshot_date && <div style={card.detail}>{fmtDate(account.latest_snapshot_date)}</div>}
        </div>
      </button>

      {expanded && (
        <div style={card.body}>
          {mySnaps.length > 0 && (
            <div style={card.evtList}>
              {mySnaps.map(snap => (
                <div key={snap.id} style={card.evt}>
                  <div style={card.evtTop}>
                    <span style={card.evtDate}>{fmtDate(snap.snapshot_date)}</span>
                    <span style={card.evtAmount}>{fmt(snap.balance)}</span>
                  </div>
                  {snap.note && <div style={card.evtNotes}>{snap.note}</div>}
                </div>
              ))}
            </div>
          )}
          <button style={card.addBtn} onClick={onAddSnapshot}>+ Add Snapshot</button>
        </div>
      )}
    </div>
  )
}

const card = {
  wrap: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '14px 16px', width: '100%',
    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
  },
  left: { flex: 1, minWidth: 0, marginRight: 12 },
  right: { textAlign: 'right', flexShrink: 0 },
  name: { fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', marginBottom: 3 },
  sub: { fontSize: '0.8rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  amount: { fontSize: '1rem', fontWeight: 700, color: 'var(--text)' },
  detail: { fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 },
  body: {
    borderTop: '1px solid var(--border)',
    padding: '12px 16px 14px',
    background: 'var(--bg)',
  },
  metaRow: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12,
  },
  evtList: { marginBottom: 12 },
  evt: {
    padding: '8px 0',
    borderBottom: '1px solid var(--border-subtle)',
  },
  evtTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  evtType: { fontSize: '0.83rem', fontWeight: 600, color: 'var(--text)' },
  evtDate: { fontSize: '0.78rem', color: 'var(--text-muted)' },
  evtAmount: { fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 2 },
  evtNotes: { fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: 3 },
  addBtn: {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: '1px dashed var(--border)', background: 'none',
    color: 'var(--text-muted)', fontSize: '0.83rem', cursor: 'pointer',
  },
}

// ─── Dashboard Tab ─────────────────────────────────────────────────────────

function DashboardTab({ summary, investments }) {
  return (
    <div>
      <div style={tab.statGrid}>
        <StatCard label="Invested" value={fmt(summary.total_principal)} />
        <StatCard label="Monthly" value={fmt(summary.projected_monthly)} />
        <StatCard label="Annual" value={fmt(summary.projected_annual)} />
        <StatCard label="Loans" value={String(summary.active_count)} />
      </div>

      <p style={tab.sectionLabel}>Active Loans</p>
      {[...investments]
        .sort((a, b) => b.principal_outstanding - a.principal_outstanding)
        .map(inv => (
          <div key={inv.id} style={tab.summaryCard}>
            <div style={tab.summaryLeft}>
              <div style={tab.summaryName}>{inv.project_name}</div>
              <div style={tab.summarySub}>{pct(inv.current_rate)} · started {fmtDate(inv.start_date)}</div>
            </div>
            <div style={tab.summaryRight}>
              <div style={tab.summaryPrincipal}>{fmt(inv.principal_outstanding)}</div>
              <div style={tab.summaryMonthly}>{fmt(inv.projected_monthly)}/mo</div>
            </div>
          </div>
        ))}
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div style={tab.statCard}>
      <span style={tab.statLabel}>{label}</span>
      <span style={tab.statValue}>{value}</span>
    </div>
  )
}

const tab = {
  statGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 },
  statCard: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4,
  },
  statLabel: { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' },
  statValue: { fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' },
  sectionLabel: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 10 },
  summaryCard: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, marginBottom: 8,
  },
  summaryLeft: { flex: 1, minWidth: 0, marginRight: 10 },
  summaryRight: { textAlign: 'right', flexShrink: 0 },
  summaryName: { fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)', marginBottom: 2 },
  summarySub: { fontSize: '0.76rem', color: 'var(--text-muted)' },
  summaryPrincipal: { fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' },
  summaryMonthly: { fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 1 },
}

// ─── Investments Tab ───────────────────────────────────────────────────────

function InvestmentsTab({ investments, onAddInvestment, onAddEvent }) {
  const [filter, setFilter] = useState('active')
  const [expanded, setExpanded] = useState(null)

  const visible = investments.filter(inv => {
    if (filter === 'active') return inv.status === 'active'
    if (filter === 'closed') return inv.status === 'closed'
    return true
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {['active', 'closed', 'all'].map(f => (
          <button key={f} style={{ ...pill.btn, ...(filter === f ? pill.active : {}) }} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button style={pill.add} onClick={onAddInvestment}>+ New</button>
      </div>

      {visible.length === 0
        ? <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '32px 0' }}>No {filter} investments.</p>
        : visible.map(inv => (
          <InvestmentCard
            key={inv.id}
            inv={inv}
            expanded={expanded === inv.id}
            onToggle={() => setExpanded(e => e === inv.id ? null : inv.id)}
            onAddEvent={() => onAddEvent(inv.id)}
          />
        ))
      }
    </div>
  )
}

// ─── Accounts Tab ──────────────────────────────────────────────────────────

function AccountsTab({ accounts, snapshots, onAddAccount, onAddSnapshot }) {
  const [expanded, setExpanded] = useState(null)
  const total = accounts.reduce((s, a) => s + (a.latest_balance ?? 0), 0)

  return (
    <div>
      <div style={{ background: 'var(--text)', color: 'var(--bg)', borderRadius: 12, padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, opacity: 0.65 }}>Total Balance</span>
        <span style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>{fmt(total)}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button style={pill.add} onClick={onAddAccount}>+ Account</button>
        <button style={pill.add} onClick={() => onAddSnapshot(null)}>+ Snapshot</button>
      </div>

      {accounts.map(acc => (
        <AccountCard
          key={acc.id}
          account={acc}
          snapshots={snapshots}
          expanded={expanded === acc.id}
          onToggle={() => setExpanded(e => e === acc.id ? null : acc.id)}
          onAddSnapshot={() => onAddSnapshot(acc.id)}
        />
      ))}
    </div>
  )
}

const pill = {
  btn: {
    padding: '6px 14px', borderRadius: 20,
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text-muted)', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
  },
  active: {
    background: 'var(--text)', color: 'var(--bg)', borderColor: 'var(--text)',
  },
  add: {
    marginLeft: 'auto', padding: '6px 14px', borderRadius: 20,
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
  },
}

// ─── Bottom Tab Bar ────────────────────────────────────────────────────────

function BottomTabs({ active, onChange }) {
  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 58, background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', zIndex: 100 }}>
      {[['dashboard', 'Overview'], ['investments', 'Investments'], ['accounts', 'Accounts']].map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            flex: 1, border: 'none', background: 'none', cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: active === id ? 700 : 500,
            color: active === id ? 'var(--text)' : 'var(--text-faint)',
            borderTop: active === id ? '2px solid var(--text)' : '2px solid transparent',
            padding: '0 4px 4px',
            transition: 'color 0.1s',
          }}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────

export default function FinancePage({ getAccessToken }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)
  const [investments, setInvestments] = useState([])
  const [accounts, setAccounts] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [modal, setModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sum, invs, accs, snaps] = await Promise.all([
        apiFetch('/summary', getAccessToken),
        apiFetch('/investments?status=all', getAccessToken),
        apiFetch('/accounts', getAccessToken),
        apiFetch('/snapshots', getAccessToken),
      ])
      setSummary(sum)
      setInvestments(invs)
      setAccounts(accs)
      setSnapshots(snaps)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [getAccessToken])

  useEffect(() => { load() }, [load])

  async function post(path, body) {
    await apiFetch(path, getAccessToken, { method: 'POST', body: JSON.stringify(body) })
    await load()
  }

  const closeModal = () => setModal(null)

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
        <p style={{ color: '#e53e3e', fontSize: '0.9rem', textAlign: 'center' }}>{error}</p>
        <button onClick={load} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer' }}>Retry</button>
      </div>
    )
  }

  const activeInvestments = investments.filter(i => i.status === 'active')

  return (
    <>
      <main style={{ flex: 1, padding: '16px 16px 76px', maxWidth: 560, margin: '0 auto', width: '100%' }}>
        {activeTab === 'dashboard' && <DashboardTab summary={summary} investments={activeInvestments} />}
        {activeTab === 'investments' && (
          <InvestmentsTab
            investments={investments}
            onAddInvestment={() => setModal({ type: 'addInvestment' })}
            onAddEvent={id => setModal({ type: 'addEvent', invId: id })}
          />
        )}
        {activeTab === 'accounts' && (
          <AccountsTab
            accounts={accounts}
            snapshots={snapshots}
            onAddAccount={() => setModal({ type: 'addAccount' })}
            onAddSnapshot={accId => setModal({ type: 'addSnapshot', accId })}
          />
        )}
      </main>

      <BottomTabs active={activeTab} onChange={setActiveTab} />

      {modal?.type === 'addInvestment' && (
        <Modal title="New Investment" onClose={closeModal}>
          <AddInvestmentForm onSave={b => post('/investments', b)} onClose={closeModal} />
        </Modal>
      )}
      {modal?.type === 'addEvent' && (
        <Modal title="Add Event" onClose={closeModal}>
          <AddEventForm investmentId={modal.invId} onSave={b => post('/events', b)} onClose={closeModal} />
        </Modal>
      )}
      {modal?.type === 'addAccount' && (
        <Modal title="New Account" onClose={closeModal}>
          <AddAccountForm onSave={b => post('/accounts', b)} onClose={closeModal} />
        </Modal>
      )}
      {modal?.type === 'addSnapshot' && (
        <Modal title="Add Balance Snapshot" onClose={closeModal}>
          <AddSnapshotForm accounts={accounts} initialAccountId={modal.accId} onSave={b => post('/snapshots', b)} onClose={closeModal} />
        </Modal>
      )}
    </>
  )
}

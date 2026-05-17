const s = {
  bar: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 },
  field: { display: 'flex', flexDirection: 'column', fontSize: 12, color: 'var(--text-muted)' },
  input: { padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 },
}

const CAMS = ['952-N', '952-S', '957-N', '957-S', '1053-N', '3285-N', '3287-N', '3288-N', '3289-S', '3291-E']
const DECISIONS = ['', 'keep', 'unusable', 'needs_follow_up']
const SOURCES = ['', 'tier_1', 'tier_2', 'propagated', 'manual']
const FLAGGED = [['', 'all'], ['true', 'flagged by AI'], ['false', 'not flagged']]

export default function FilterBar({ filters, onChange }) {
  const set = (k, v) => onChange({ ...filters, [k]: v })

  return (
    <div style={s.bar}>
      <label style={s.field}>
        cam
        <select style={s.input} value={filters.cam_id ?? ''} onChange={e => set('cam_id', e.target.value)}>
          <option value="">all</option>
          {CAMS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label style={s.field}>
        from
        <input style={s.input} type="datetime-local" value={filters.start ?? ''} onChange={e => set('start', e.target.value)} />
      </label>
      <label style={s.field}>
        to
        <input style={s.input} type="datetime-local" value={filters.end ?? ''} onChange={e => set('end', e.target.value)} />
      </label>
      <label style={s.field}>
        decision
        <select style={s.input} value={filters.decision ?? ''} onChange={e => set('decision', e.target.value)}>
          {DECISIONS.map(d => <option key={d} value={d}>{d || 'any'}</option>)}
        </select>
      </label>
      <label style={s.field}>
        source
        <select style={s.input} value={filters.source ?? ''} onChange={e => set('source', e.target.value)}>
          {SOURCES.map(d => <option key={d} value={d}>{d || 'any'}</option>)}
        </select>
      </label>
      <label style={s.field}>
        confidence ≤
        <input style={s.input} type="number" step="0.05" min="0" max="1"
          value={filters.confidence_lte ?? ''} onChange={e => set('confidence_lte', e.target.value)} />
      </label>
      <label style={s.field}>
        visibility ≤ (mi)
        <input style={s.input} type="number" step="0.1"
          value={filters.visibility_lte ?? ''} onChange={e => set('visibility_lte', e.target.value)} />
      </label>
      <label style={s.field}>
        AI flagged
        <select style={s.input} value={filters.needs_review ?? ''} onChange={e => set('needs_review', e.target.value)}>
          {FLAGGED.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
    </div>
  )
}

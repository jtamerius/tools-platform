import { useEffect, useState, useRef } from 'react'
import ZoneEditor from '../components/ZoneEditor'
import BboxEditor from '../components/BboxEditor'

const CAMS = ['952-N', '952-S', '957-N', '957-S', '1053-N', '3285-N', '3287-N', '3288-N', '3289-S', '3291-E']
const LABEL_MODES = [['all', 'All'], ['unlabeled', 'Unlabeled'], ['labeled', 'Labeled']]

const s = {
  page: { display: 'flex', flexDirection: 'column', gap: 16 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  label: { fontSize: 12, color: 'var(--text-muted)' },
  select: { padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 },
  input: { padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' },
  tab: (active) => ({
    padding: '6px 14px',
    background: 'transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  }),
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 },
  cardTitle: { fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' },
  btn: (variant) => ({
    padding: '5px 14px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: variant === 'primary' ? 'var(--accent)' : variant === 'danger' ? '#7f1d1d' : 'var(--surface)',
    color: variant === 'primary' ? '#000' : 'var(--text)',
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: variant === 'primary' ? 600 : 400,
  }),
  muted: { color: 'var(--text-muted)', fontSize: 13 },
  grid: { display: 'grid', gridTemplateColumns: 'auto repeat(5, 1fr)', gap: 1, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' },
  gridCell: (bg) => ({ padding: '6px 10px', background: bg || 'var(--surface)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }),
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 400, borderBottom: '1px solid var(--border)' },
  td: { padding: '6px 8px', borderBottom: '1px solid var(--border)' },
  tag: (color) => ({ display: 'inline-block', padding: '1px 7px', borderRadius: 10, background: color + '33', border: `1px solid ${color}`, fontSize: 11 }),
}

// ── Zones Tab ─────────────────────────────────────────────────────────────────

function ZonesTab({ camId, api }) {
  const [imageUrl, setImageUrl] = useState(null)
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)
  const [latestRecord, setLatestRecord] = useState(null)

  useEffect(() => {
    setImageUrl(null)
    setZones([])
    setStatus(null)
    if (!camId) return
    setLoading(true)
    Promise.all([
      api.fetchCamConfig(camId),
      api.fetchLabelQueue(camId, 48, 'all'),
    ]).then(([cfg, recs]) => {
      setZones(cfg.zones || [])
      const daytime = recs.filter(r => parseFloat(r.solar_altitude_deg ?? -90) >= 10)
      const rec = daytime.sort((a, b) => b.sk < a.sk ? -1 : 1)[0] || null
      setLatestRecord(rec || null)
      if (rec?.pk && rec?.sk) {
        return api.fetchImage(rec.pk, rec.sk)
      }
    }).then(url => {
      if (url) setImageUrl(url)
    }).catch(e => setStatus({ type: 'error', msg: e.message }))
      .finally(() => setLoading(false))
  }, [camId, api])

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      await api.saveCamZones(camId, zones)
      setStatus({ type: 'ok', msg: `Saved ${zones.length} zone(s). Active on next ingest tick.` })
    } catch (e) {
      setStatus({ type: 'error', msg: e.message })
    } finally {
      setSaving(false)
    }
  }

  const ZONE_COLORS_MAP = { Inbound: '#60a5fa', Outbound: '#f59e0b' }

  if (loading) return <div style={s.muted}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {['Inbound', 'Outbound'].map(name => {
          const exists = zones.some(z => z.name === name)
          const color = ZONE_COLORS_MAP[name]
          return (
            <span key={name} style={{
              padding: '3px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600,
              background: exists ? color + '33' : 'var(--surface)',
              border: `1px solid ${exists ? color : 'var(--border)'}`,
              color: exists ? color : 'var(--text-muted)',
            }}>
              {exists ? '✓' : '—'} {name}
            </span>
          )
        })}
        {latestRecord && <span style={{ ...s.muted, marginLeft: 4 }}>image: {latestRecord.sk}</span>}
      </div>
      {imageUrl
        ? <ZoneEditor imageUrl={imageUrl} zones={zones} onChange={setZones} />
        : <div style={{ ...s.card, textAlign: 'center', ...s.muted }}>No daytime image found in the last 48h for {camId}</div>
      }
      <div style={s.row}>
        <button style={s.btn('primary')} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Zones'}
        </button>
        {status && (
          <span style={{ fontSize: 13, color: status.type === 'ok' ? 'var(--accent)' : 'var(--red)' }}>
            {status.msg}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Labels Tab ────────────────────────────────────────────────────────────────

function LabelsTab({ camId, api }) {
  const [mode, setMode] = useState('unlabeled')
  const [queue, setQueue] = useState([])
  const [cursor, setCursor] = useState(0)
  const [imageUrl, setImageUrl] = useState(null)
  const [labelData, setLabelData] = useState(null)
  const [boxes, setBoxes] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

  const currentRec = queue[cursor]

  useEffect(() => {
    setQueue([])
    setCursor(0)
    setImageUrl(null)
    setLabelData(null)
    setBoxes([])
    setStatus(null)
    if (!camId) return
    setLoading(true)
    api.fetchLabelQueue(camId, 48, mode)
      .then(recs => setQueue(recs.slice().sort((a, b) => (a.labeled - b.labeled) || (b.sk > a.sk ? 1 : -1))))
      .catch(e => setStatus({ type: 'error', msg: e.message }))
      .finally(() => setLoading(false))
  }, [camId, mode, api])

  useEffect(() => {
    setImageUrl(null)
    setLabelData(null)
    setBoxes([])
    setStatus(null)
    if (!currentRec) return
    setLoading(true)
    Promise.all([
      api.fetchImage(currentRec.pk, currentRec.sk),
      api.fetchLabel(currentRec.pk, currentRec.sk),
    ]).then(([url, lbl]) => {
      setImageUrl(url)
      setLabelData(lbl)
      setBoxes(lbl.boxes || [])
    }).catch(e => setStatus({ type: 'error', msg: e.message }))
      .finally(() => setLoading(false))
  }, [cursor, currentRec?.pk, currentRec?.sk])

  const save = async () => {
    if (!currentRec || !labelData) return
    setSaving(true)
    setStatus(null)
    try {
      await api.saveLabel(currentRec.pk, currentRec.sk, boxes, labelData.image_width, labelData.image_height)
      setStatus({ type: 'ok', msg: `Saved ${boxes.length} box(es)` })
      setQueue(prev => prev.map((r, i) => i === cursor ? { ...r, labeled: true, label_count: boxes.length } : r))
      setTimeout(() => nav(1), 600)
    } catch (e) {
      setStatus({ type: 'error', msg: e.message })
    } finally {
      setSaving(false)
    }
  }

  const nav = (delta) => {
    setCursor(c => Math.max(0, Math.min(c + delta, queue.length - 1)))
  }

  const labeled = queue.filter(r => r.labeled).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={s.row}>
        <span style={s.label}>Queue</span>
        {LABEL_MODES.map(([v, l]) => (
          <button key={v} style={s.btn(mode === v ? 'primary' : null)} onClick={() => setMode(v)}>{l}</button>
        ))}
        <span style={s.muted}>{labeled}/{queue.length} labeled</span>
      </div>

      {loading && <div style={s.muted}>Loading…</div>}

      {!loading && queue.length === 0 && (
        <div style={s.muted}>No records for this cam in the last 48h.</div>
      )}

      {currentRec && (
        <>
          <div style={s.row}>
            <span style={s.muted}>{cursor + 1} / {queue.length} · {currentRec.sk}</span>
            {currentRec.labeled && <span style={s.tag('#34d399')}>labeled</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button style={s.btn()} onClick={() => nav(-1)} disabled={cursor === 0}>← Prev</button>
              <button style={s.btn()} onClick={() => nav(1)} disabled={cursor === queue.length - 1}>Next →</button>
            </div>
          </div>

          {imageUrl && labelData
            ? <BboxEditor
                key={`${currentRec.pk}|${currentRec.sk}`}
                imageUrl={imageUrl}
                initialBoxes={boxes}
                imageWidth={labelData.image_width}
                imageHeight={labelData.image_height}
                onChange={setBoxes}
              />
            : <div style={s.muted}>Loading image…</div>
          }

          <div style={s.row}>
            <button style={s.btn('primary')} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : `Save (${boxes.length} boxes)`}
            </button>
            <button style={s.btn()} onClick={() => nav(1)} disabled={cursor === queue.length - 1}>Skip →</button>
            {status && (
              <span style={{ fontSize: 13, color: status.type === 'ok' ? 'var(--accent)' : 'var(--red)' }}>
                {status.msg}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Models Tab ────────────────────────────────────────────────────────────────

function MetricsRow({ label, value }) {
  return (
    <tr>
      <td style={{ ...s.td, color: 'var(--text-muted)' }}>{label}</td>
      <td style={s.td}>{value ?? '—'}</td>
    </tr>
  )
}

function VersionPanel({ camId, versions, onRefresh, api }) {
  const [editingId, setEditingId] = useState(null) // version number being edited
  const [editVals, setEditVals] = useState({})
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState(null)
  const [newInference, setNewInference] = useState({ conf: 0.45, iou: 0.50, agnostic_nms: true, max_det: 50 })
  const fileRef = useRef(null)

  const activate = async (version) => {
    try {
      await api.updateModelMeta(camId, version, { active: true })
      onRefresh()
    } catch (e) {
      alert(e.message)
    }
  }

  const saveEdit = async (version) => {
    try {
      await api.updateModelMeta(camId, version, { inference: editVals.inference, metrics: editVals.metrics })
      setEditingId(null)
      onRefresh()
    } catch (e) {
      alert(e.message)
    }
  }

  const startUpload = async () => {
    setUploadStatus(null)
    setUploading(true)
    try {
      const { upload_url, version } = await api.getModelUploadUrl(camId, newInference)
      const file = fileRef.current?.files?.[0]
      if (!file) { setUploadStatus({ type: 'error', msg: 'No file selected' }); return }
      const res = await fetch(upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      setUploadStatus({ type: 'ok', msg: `Uploaded as v${version}` })
      onRefresh()
    } catch (e) {
      setUploadStatus({ type: 'error', msg: e.message })
    } finally {
      setUploading(false)
    }
  }

  if (versions.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={s.muted}>No versions uploaded for {camId}.</div>
        <UploadForm fileRef={fileRef} inference={newInference} setInference={setNewInference}
          onUpload={startUpload} uploading={uploading} status={uploadStatus} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <table style={s.table}>
        <thead>
          <tr>
            {['v', 'Uploaded', 'mAP50', 'F1', 'conf', 'iou', 'Active', ''].map(h => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {versions.map(m => {
            const isEditing = editingId === m.version
            return (
              <tr key={m.version}>
                <td style={s.td}>{m.version}</td>
                <td style={s.td}>{m.uploaded_at?.slice(0, 10)}</td>
                <td style={s.td}>{m.metrics?.mAP50 ?? '—'}</td>
                <td style={s.td}>{m.metrics?.f1 ?? '—'}</td>
                <td style={s.td}>
                  {isEditing
                    ? <input style={{ ...s.input, width: 50 }} type="number" step="0.05" value={editVals.inference?.conf ?? m.inference?.conf}
                        onChange={e => setEditVals(v => ({ ...v, inference: { ...v.inference, conf: parseFloat(e.target.value) } }))} />
                    : m.inference?.conf}
                </td>
                <td style={s.td}>
                  {isEditing
                    ? <input style={{ ...s.input, width: 50 }} type="number" step="0.05" value={editVals.inference?.iou ?? m.inference?.iou}
                        onChange={e => setEditVals(v => ({ ...v, inference: { ...v.inference, iou: parseFloat(e.target.value) } }))} />
                    : m.inference?.iou}
                </td>
                <td style={s.td}>{m.active ? '✓' : ''}</td>
                <td style={s.td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!m.active && <button style={s.btn('primary')} onClick={() => activate(m.version)}>Activate</button>}
                    {isEditing
                      ? <button style={s.btn('primary')} onClick={() => saveEdit(m.version)}>Save</button>
                      : <button style={s.btn()} onClick={() => {
                          setEditingId(m.version)
                          setEditVals({ inference: { ...m.inference }, metrics: { ...m.metrics } })
                        }}>Edit</button>
                    }
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <UploadForm fileRef={fileRef} inference={newInference} setInference={setNewInference}
        onUpload={startUpload} uploading={uploading} status={uploadStatus} />
    </div>
  )
}

function UploadForm({ fileRef, inference, setInference, onUpload, uploading, status }) {
  const set = (k, v) => setInference(prev => ({ ...prev, [k]: v }))
  return (
    <div style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={s.cardTitle}>Upload new version</div>
      <div style={s.row}>
        <label style={s.label}>conf <input style={{ ...s.input, width: 60 }} type="number" step="0.05" value={inference.conf}
          onChange={e => set('conf', parseFloat(e.target.value))} /></label>
        <label style={s.label}>iou <input style={{ ...s.input, width: 60 }} type="number" step="0.05" value={inference.iou}
          onChange={e => set('iou', parseFloat(e.target.value))} /></label>
        <label style={s.label}>max_det <input style={{ ...s.input, width: 60 }} type="number" value={inference.max_det}
          onChange={e => set('max_det', parseInt(e.target.value))} /></label>
        <label style={s.label}>
          agnostic_nms
          <input type="checkbox" checked={inference.agnostic_nms} onChange={e => set('agnostic_nms', e.target.checked)} style={{ marginLeft: 4 }} />
        </label>
      </div>
      <div style={s.row}>
        <input ref={fileRef} type="file" accept=".pt" style={{ fontSize: 13 }} />
        <button style={s.btn('primary')} onClick={onUpload} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload .pt'}
        </button>
        {status && (
          <span style={{ fontSize: 13, color: status.type === 'ok' ? 'var(--accent)' : 'var(--red)' }}>
            {status.msg}
          </span>
        )}
      </div>
    </div>
  )
}

function ExportPanel({ api }) {
  const [split, setSplit] = useState('70/15/15')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const run = async () => {
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const data = await api.exportLabels('all', { split })
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Export all labeled data (YOLO format — all cameras)</div>
      <div style={s.row}>
        <label style={s.label}>
          Split (train/val/test)
          <input style={{ ...s.input, width: 100, marginLeft: 6 }} value={split} onChange={e => setSplit(e.target.value)} />
        </label>
        <button style={s.btn('primary')} onClick={run} disabled={loading}>
          {loading ? 'Exporting…' : 'Export ZIP'}
        </button>
      </div>
      {result && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--accent)' }}>
            {result.total} labeled images → {result.train} train / {result.val} val / {result.test} test
          </div>
          <a href={result.download_url} download style={{ ...s.btn('primary'), display: 'inline-block', textDecoration: 'none', textAlign: 'center', width: 160 }}>
            Download ZIP
          </a>
          <div style={s.muted}>
            Training command: <code style={{ background: 'var(--bg)', padding: '1px 4px', borderRadius: 3 }}>
              yolo train data=data.yaml model=yolov8n.pt epochs=50 imgsz=640
            </code>
          </div>
        </div>
      )}
      {error && <div style={{ marginTop: 8, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
    </div>
  )
}

function ModelsTab({ api }) {
  const camId = 'shared'
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    api.fetchModels(camId)
      .then(data => setVersions(data.versions || []))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { setVersions([]); load() }, [])

  if (loading) return <div style={s.muted}>Loading models…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={s.card}>
        <div style={s.cardTitle}>Shared model — trained on all cameras</div>
        <VersionPanel camId={camId} versions={versions} onRefresh={load} api={api} />
      </div>
      <ExportPanel api={api} />
    </div>
  )
}

// ── Main AnnotatePage ──────────────────────────────────────────────────────────

export default function AnnotatePage({ api }) {
  const [camId, setCamId] = useState('952-N')
  const [subTab, setSubTab] = useState('zones')

  return (
    <div style={s.page}>
      {subTab !== 'models' && (
        <div style={s.row}>
          <span style={s.label}>Camera</span>
          <select style={s.select} value={camId} onChange={e => setCamId(e.target.value)}>
            {CAMS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      <div style={s.tabs}>
        {[['zones', 'Zones'], ['labels', 'Labels'], ['models', 'Models']].map(([v, l]) => (
          <button key={v} style={s.tab(subTab === v)} onClick={() => setSubTab(v)}>{l}</button>
        ))}
      </div>

      {subTab === 'zones' && <ZonesTab camId={camId} api={api} />}
      {subTab === 'labels' && <LabelsTab camId={camId} api={api} />}
      {subTab === 'models' && <ModelsTab api={api} />}
    </div>
  )
}

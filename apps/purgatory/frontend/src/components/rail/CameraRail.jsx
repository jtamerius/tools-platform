import { CAMS, VOID } from '../../lib/cams'
import CameraRow, { GRID } from './CameraRow'
import RailVoidBand from './RailVoidBand'
import RwisRow from './RwisRow'

/**
 * Ten cameras, always on screen, in corridor order — resort first.
 *
 * Row order IS the spatial encoding. Adjacency is the analysis: ten instruments
 * on one road are read by comparing neighbours, which is why they are never
 * paginated, never behind a selector, and never coloured by identity.
 */
export default function CameraRail({ rows, api, selected, onSelect, rwis }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <h2 style={{ marginBottom: 10 }}>Which cameras, and what do they see?</h2>

      <div style={{
        display: 'grid', gridTemplateColumns: GRID, gap: 10,
        padding: '0 12px 6px', borderBottom: '1px solid var(--rule-strong)',
      }}>
        {['CAM', 'WHERE', 'NOW', 'LAST 24 H', 'OCC', 'VS TYPICAL'].map((h, i) => (
          <span key={h} className="label" style={{ fontSize: 10, textAlign: i === 4 ? 'right' : 'left' }}>{h}</span>
        ))}
      </div>

      <div className="ruled" style={{ borderTop: 'none' }}>
        {CAMS.map(cam => (
          <div key={cam.id} style={{ display: 'contents' }}>
            <CameraRow
              cam={cam}
              row={rows?.[cam.id]}
              api={api}
              selected={selected === cam.id}
              onSelect={onSelect}
            />
            {cam.id === VOID.afterId && <RailVoidBand />}
          </div>
        ))}
        <RwisRow rwis={rwis} />
      </div>
    </section>
  )
}

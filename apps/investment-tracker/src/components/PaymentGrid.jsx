import { useState, useEffect, useRef } from 'react';
import { fetchPaymentGrid, setCellOverride } from '../services/api';
import './PaymentGrid.css';

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function buildReceivedMap(cells) {
  const map = {}
  for (const cell of cells) {
    if (!cell.date_received) continue
    const [yr, mo, dy] = cell.date_received.split('-').map(Number)
    const key = `${yr}-${mo - 1}`
    if (!map[key]) map[key] = []
    map[key].push(dy)
  }
  return map
}

const STATUS_OPTIONS = [
  { value: 'auto', label: 'Auto', icon: '↺' },
  { value: 'paid', label: 'Paid', icon: '✓' },
  { value: 'missing', label: 'Missing', icon: '✗' },
  { value: 'na', label: 'N/A', icon: '—' },
];

export default function PaymentGrid({ onSelectAccount, showClosed }) {
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { acct, year, month, cell, rect }
  const [noteText, setNoteText] = useState('');
  const scrollRef = useRef(null);
  const popRef = useRef(null);

  const reload = () => fetchPaymentGrid().then(setGrid);

  useEffect(() => { reload().then(() => setLoading(false)); }, []);

  useEffect(() => {
    if (grid && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [grid]);

  // Close popover on outside click
  useEffect(() => {
    if (!editing) return;
    const handler = e => {
      if (popRef.current && !popRef.current.contains(e.target)) setEditing(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing]);

  const handleCellClick = (e, acct, cell) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setEditing({ acct, year: cell.year, month: cell.month, cell, rect });
    setNoteText(cell.note || '');
  };

  const handleSetStatus = async (status) => {
    const s = status === 'auto' ? null : status;
    await setCellOverride(editing.acct, editing.year, editing.month, s, noteText);
    setEditing(null);
    reload();
  };

  const handleSaveNote = async () => {
    const currentOverride = editing.cell.override;
    await setCellOverride(editing.acct, editing.year, editing.month, currentOverride, noteText);
    setEditing(null);
    reload();
  };

  if (loading) return <p className="grid-loading">Loading payment grid…</p>;
  if (!grid) return null;

  return (
    <div className="payment-grid-wrapper">
      <h2>Payment Overview</h2>
      <p className="grid-legend">
        <span className="legend-paid">✓ Paid</span>
        <span className="legend-missing">✗ Missing</span>
        <span className="legend-na">— N/A</span>
      </p>
      <div className="payment-grid-scroll" ref={scrollRef}>
        <table className="payment-grid">
          <thead>
            <tr>
              <th className="sticky-col">Account</th>
              {grid.months.map(m => (
                <th key={`${m.year}-${m.month}`}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.filter(row => showClosed || !row.is_closed).map(row => {
              const receivedMap = buildReceivedMap(row.cells)
              return (
              <tr key={row.account_number}>
                <td
                  className="sticky-col account-cell"
                  onClick={() => onSelectAccount?.(row.account_number)}
                  title={row.payor}
                >
                  <span className="cell-acct">
                    {row.payor?.split(' ').slice(0, 2).join(' ')}
                  </span>
                  <span className="cell-num">{row.account_number}</span>
                </td>
                {row.cells.map((cell, i) => {
                  const now = new Date();
                  const cellDate = new Date(cell.year, cell.month + 1, 0);
                  const isFuture = cellDate > now;
                  const isBeforeStart = row.first_year != null &&
                    (cell.year < row.first_year || (cell.year === row.first_year && cell.month < row.first_month));
                  const isNa = cell.override === 'na';

                  let cls = 'cell-na';
                  let icon = '—';
                  if (isNa) {
                    cls = 'cell-na';
                    icon = '—';
                  } else if (cell.paid) {
                    cls = 'cell-paid';
                    icon = '✓';
                  } else if (!isFuture && !isBeforeStart) {
                    cls = 'cell-missing';
                    icon = '✗';
                  }

                  const hasNote = !!cell.note;
                  const hasOverride = !!cell.override;

                  return (
                    <td
                      key={i}
                      className={`grid-cell ${cls} ${hasNote ? 'has-note' : ''} ${hasOverride ? 'has-override' : ''}`}
                      title={
                        cell.note
                          ? cell.note
                          : cell.paid
                            ? `$${cell.amount?.toLocaleString()} — rcvd ${cell.date_received}${cell.interest_paid_to ? `, int paid to ${cell.interest_paid_to}` : ''}`
                            : isFuture || isBeforeStart || isNa
                              ? 'N/A'
                              : 'Missing payment'
                      }
                      onClick={e => handleCellClick(e, row.account_number, cell)}
                    >
                      {icon}
                      {(() => {
                        const dots = receivedMap[`${cell.year}-${cell.month}`] || [];
                        if (!dots.length) return null;
                        const dim = daysInMonth(cell.year, cell.month);
                        return (
                          <div className="received-dots">
                            {dots.map((day, di) => {
                              const pct = dim > 1 ? (day - 1) / (dim - 1) : 0;
                              return (
                                <span
                                  key={di}
                                  className="received-dot"
                                  style={{ left: `calc(3px + ${pct} * (100% - 6px))`, bottom: `${3 + di * 5}px` }}
                                />
                              );
                            })}
                          </div>
                        );
                      })()}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div
          ref={popRef}
          className="cell-popover"
          style={{
            top: editing.rect.bottom + 4,
            left: Math.min(editing.rect.left, window.innerWidth - 220),
          }}
        >
          <div className="pop-status-row">
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`pop-status-btn ${
                  (opt.value === 'auto' && !editing.cell.override) ||
                  opt.value === editing.cell.override
                    ? 'active'
                    : ''
                }`}
                onClick={() => handleSetStatus(opt.value)}
                title={opt.label}
              >
                {opt.icon}
              </button>
            ))}
          </div>
          <textarea
            className="pop-note"
            placeholder="Add a note…"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            rows={2}
          />
          <button className="pop-save" onClick={handleSaveNote}>
            Save Note
          </button>
        </div>
      )}
    </div>
  );
}

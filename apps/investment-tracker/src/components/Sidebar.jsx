import './Sidebar.css';

const fmtK = v => {
  if (v == null || v === 0) return '$0';
  const rounded = Math.round(v / 1000) * 1000;
  return `$${(rounded / 1000).toFixed(0)}k`;
};

export default function Sidebar({ accounts, selected, showClosed, onSelect }) {
  const visible = showClosed ? accounts : accounts.filter(a => !a.is_closed);
  const totalInvested = visible.reduce((s, a) => s + (a.investment?.estimated_investment ?? 0), 0);

  return (
    <aside className="sidebar">
      <div className="sidebar-summary">
        <span className="summary-label">Total Invested</span>
        <span className="summary-value">{fmtK(Math.round(totalInvested))}</span>
      </div>
      <h2>Accounts</h2>
      <ul>
        {visible.map(a => (
          <li
            key={a.account_number}
            className={`${a.account_number === selected ? 'active' : ''} ${a.is_closed ? 'closed' : ''}`}
            onClick={() => onSelect(a.account_number)}
          >
            <div className="acct-row-top">
              <span className="acct-payor">
                {a.payor?.split(' ').slice(0, 3).join(' ')}
              </span>
              <span className="acct-inv">
                {fmtK(Math.round(a.investment?.estimated_investment ?? 0))}
              </span>
            </div>
            <span className="acct-num">
              {a.account_number}
              {a.is_closed && <span className="closed-tag">CLOSED</span>}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

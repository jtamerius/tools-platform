import './AccountList.css';

const fmtK = v => {
  if (v == null || v === 0) return '$0';
  const rounded = Math.round(v / 1000) * 1000;
  return `$${(rounded / 1000).toFixed(0)}k`;
};

export default function AccountList({ accounts, selected, showClosed, onSelect }) {
  const visible = showClosed ? accounts : accounts.filter(a => !a.is_closed);
  const totalInvested = visible.reduce((s, a) => s + (a.investment?.estimated_investment ?? 0), 0);

  return (
    <div className="account-list">
      <div className="account-list-summary">
        <span className="summary-label">Total Invested</span>
        <span className="summary-value">{fmtK(Math.round(totalInvested))}</span>
      </div>
      <div className="account-list-items">
        {visible.map(a => (
          <button
            key={a.account_number}
            className={`account-card${a.account_number === selected ? ' active' : ''}${a.is_closed ? ' closed' : ''}`}
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
          </button>
        ))}
      </div>
    </div>
  );
}

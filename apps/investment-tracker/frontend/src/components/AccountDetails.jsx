import './AccountDetails.css';

const fmt = v =>
  v != null
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

export default function AccountDetails({ payment, account }) {
  const s = payment.status || {};
  return (
    <section className="account-details">
      <h3>Account Status</h3>
      <div className="card stat-grid">
        <div className="stat">
          <span className="stat-label">Current Balance</span>
          <span className="stat-value">{fmt(s.current_balance)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Previous Balance</span>
          <span className="stat-value">{fmt(s.previous_balance)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Next Due Date</span>
          <span className="stat-value">{s.next_due_date || '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Interest Paid To</span>
          <span className="stat-value">{s.interest_paid_to || '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Late Owed</span>
          <span className="stat-value">{fmt(s.late_owed)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Late Paid</span>
          <span className="stat-value">{fmt(s.late_paid)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Principal YTD</span>
          <span className="stat-value">{fmt(s.principal_ytd)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Interest YTD</span>
          <span className="stat-value">{fmt(s.interest_ytd)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Reserve Balance</span>
          <span className="stat-value">{fmt(s.reserve_balance)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Accrued Interest</span>
          <span className="stat-value">{fmt(s.accrued_interest)}</span>
        </div>
      </div>

      <h3 style={{ marginTop: '1.5rem' }}>Info</h3>
      <div className="card">
        <table>
          <tbody>
            <tr>
              <td>Company</td>
              <td>{account.company}</td>
            </tr>
            <tr>
              <td>Recipient</td>
              <td>{account.recipient}</td>
            </tr>
            <tr>
              <td>Source</td>
              <td className="mono-small">
                {payment.metadata?.source_file}
              </td>
            </tr>
            <tr>
              <td>Parsed</td>
              <td>{payment.metadata?.parsed_at_utc}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

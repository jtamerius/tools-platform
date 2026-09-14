import './PaymentTable.css';

const fmt = v =>
  v != null
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

export default function PaymentTable({ payment }) {
  const d = payment.details || {};
  return (
    <section className="payment-section">
      <h3>Payment Details</h3>
      <div className="card">
        <table>
          <tbody>
            <tr>
              <td>Date Received</td>
              <td>{payment.date_received}</td>
            </tr>
            <tr>
              <td>Interest Paid To</td>
              <td>{payment.status?.interest_paid_to || '—'}</td>
            </tr>
            <tr className="highlight">
              <td>Total Payment</td>
              <td>{fmt(payment.payment)}</td>
            </tr>
            <tr>
              <td>Principal</td>
              <td>{fmt(d.principal)}</td>
            </tr>
            <tr>
              <td>Interest</td>
              <td>{fmt(d.interest)}</td>
            </tr>
            <tr>
              <td>Reserves</td>
              <td>{fmt(d.reserves)}</td>
            </tr>
            <tr>
              <td>Payor Fees</td>
              <td>{fmt(d.payor_fees)}</td>
            </tr>
            <tr>
              <td>Others</td>
              <td>{fmt(d.others)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {payment.disbursements?.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.25rem' }}>Disbursements</h3>
          <div className="card">
            <table>
              <tbody>
                {payment.disbursements.map((dis, i) => (
                  <tr key={i}>
                    <td>{dis.description}</td>
                    <td>{fmt(dis.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

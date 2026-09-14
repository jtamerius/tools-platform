import './StatusBadge.css';

function getStatus(payment) {
  if (!payment?.status) return { label: 'Unknown', cls: 'unknown' };
  const bal = payment.status.current_balance ?? 0;
  const late = payment.status.late_owed ?? 0;
  if (bal <= 0) return { label: 'Paid Off', cls: 'paid-off' };
  if (late > 500) return { label: 'Delinquent', cls: 'delinquent' };
  if (late > 0) return { label: 'Late', cls: 'late' };
  return { label: 'Current', cls: 'current' };
}

export default function StatusBadge({ payment }) {
  const { label, cls } = getStatus(payment);
  return <span className={`status-badge ${cls}`}>{label}</span>;
}

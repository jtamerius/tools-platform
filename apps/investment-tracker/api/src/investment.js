// Estimate user's invested amount from disbursement ratios.
// Heuristic: disbursements mentioning the user's account names (USAA, National Bank)
// represent the user's share of the payment. Ratio × current balance ≈ current investment.

const MY_ACCOUNTS = ['usaa', 'national bank'];

function computeInvestment(payments) {
  const latest = payments[payments.length - 1];
  if (!latest) {
    return { my_monthly_payout: 0, ownership_pct: 0, estimated_investment: 0, total_balance: 0 };
  }

  const disb = latest.disbursements || [];
  const fees = disb.reduce((s, d) => s + (/fee/i.test(d.description) ? d.amount : 0), 0);
  const reserves = disb.reduce((s, d) => s + (/\d+I$/.test(d.description) ? d.amount : 0), 0);
  const totalPayment = latest.payment ?? 0;
  const net = totalPayment - fees - reserves;

  const myShare = disb.reduce((s, d) => {
    const desc = (d.description || '').toLowerCase();
    return s + (MY_ACCOUNTS.some(a => desc.includes(a)) ? d.amount : 0);
  }, 0);

  const ratio = net > 0 ? myShare / net : 0;
  const balance = latest.status?.current_balance ?? 0;

  return {
    my_monthly_payout: myShare,
    ownership_pct: Math.round(ratio * 10000) / 100,
    estimated_investment: Math.round(balance * ratio * 100) / 100,
    total_balance: balance,
  };
}

module.exports = { computeInvestment };

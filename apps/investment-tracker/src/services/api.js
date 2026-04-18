const BASE = 'http://localhost:3001/api';

export async function fetchAccounts() {
  const res = await fetch(`${BASE}/accounts`);
  return res.json();
}

export async function fetchAccount(accountNumber) {
  const res = await fetch(`${BASE}/accounts/${accountNumber}`);
  return res.json();
}

export async function fetchPaymentGrid() {
  const res = await fetch(`${BASE}/payment-grid`);
  return res.json();
}

export async function setAccountClosed(accountNumber, closed) {
  const res = await fetch(`${BASE}/accounts/${accountNumber}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ closed }),
  });
  return res.json();
}

export async function setCellOverride(accountNumber, year, month, status, note) {
  const res = await fetch(`${BASE}/cells/${accountNumber}/${year}/${month}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, note }),
  });
  return res.json();
}

export async function fetchCellOverrides(accountNumber) {
  const res = await fetch(`${BASE}/cells/${accountNumber}`);
  return res.json();
}

export async function uploadFiles(files) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

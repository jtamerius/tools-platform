import { createUserPool, getIdTokenJwt } from '@tools/auth';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '') + '/api';

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '';
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? '';
let poolRef = null;
function getPool() {
  if (!poolRef && USER_POOL_ID && CLIENT_ID) {
    poolRef = createUserPool(USER_POOL_ID, CLIENT_ID);
  }
  return poolRef;
}

async function authHeaders() {
  const pool = getPool();
  if (!pool) return {};
  const jwt = await getIdTokenJwt(pool);
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

async function request(path, { method = 'GET', body, headers = {}, isForm = false } = {}) {
  const auth = await authHeaders();
  const init = {
    method,
    headers: {
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...auth,
      ...headers,
    },
  };
  if (body) init.body = isForm ? body : JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Server returned ${res.status}${text ? `: ${text}` : ''}`);
  }
  return res.json();
}

export const fetchAccounts = () => request('/accounts');
export const fetchAccount = (acct) => request(`/accounts/${acct}`);
export const fetchPaymentGrid = () => request('/payment-grid');

export const setAccountClosed = (acct, closed) =>
  request(`/accounts/${acct}/status`, { method: 'PUT', body: { closed } });

export const setCellOverride = (acct, year, month, status, note) =>
  request(`/cells/${acct}/${year}/${month}`, { method: 'PUT', body: { status, note } });

export const fetchCellOverrides = (acct) => request(`/cells/${acct}`);

export async function uploadFiles(files) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  return request('/upload', { method: 'POST', body: fd, isForm: true });
}

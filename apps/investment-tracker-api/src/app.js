const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const {
  listAccounts, getAccount, updateAccountClosed, deleteAccountClosedOverride,
  updateAccountPrincipalOverride, deleteAccountPrincipalOverride,
  deletePayment, deleteAccount, listPayments, listAllPayments, listCellOverrides, listAllCellOverrides,
  putCellOverride, deleteCellOverride, getUserEmail, putUserEmail,
} = require('./db');
const { computeInvestment } = require('./investment');

const s3 = new S3Client({});
const EMAIL_BUCKET = process.env.EMAIL_BUCKET;
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN;

const app = express();
app.use(cors());
app.use(express.json());

// Multer for the /api/upload endpoint (memory storage — payload goes straight to S3)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Unauthenticated health endpoint (API Gateway also exposes GET /health)
app.get(['/health', '/api/health'], (_req, res) => res.json({ ok: true }));

// ── Auth middleware: extract userId from API Gateway v2 JWT authorizer ──
app.use((req, res, next) => {
  const ctx = req.apiGateway?.event?.requestContext;
  const claims =
    ctx?.authorizer?.jwt?.claims ||
    ctx?.authorizer?.claims ||
    null;

  if (claims?.sub) {
    req.userId = claims.sub;
    req.userEmail = claims.email;
    return next();
  }

  // Fallback: decode the JWT from the Authorization header directly.
  // Safe because API Gateway's JWT authorizer already verified the signature
  // before invoking Lambda — we are re-reading already-validated claims.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token) {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString()
      );
      if (payload?.sub) {
        req.userId = payload.sub;
        req.userEmail = payload.email ?? '';
        return next();
      }
    } catch {}
  }

  return res.status(401).json({ error: 'Unauthenticated' });
});

// ── GET /api/me — return user info + assigned inbound email (auto-provisions on first call)
app.get('/api/me', async (req, res) => {
  try {
    let existing = await getUserEmail(req.userId);
    if (!existing) {
      // Assign a new local part derived from sub (short hash-like prefix)
      const localPart = `u${req.userId.replace(/-/g, '').slice(0, 10)}`;
      await putUserEmail(localPart, req.userId);
      existing = { localPart, userId: req.userId };
    }
    res.json({
      userId: req.userId,
      email: req.userEmail || null,
      inbound_email: `${existing.localPart}@${EMAIL_DOMAIN}`,
    });
  } catch (err) {
    console.error('GET /api/me failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: convert DDB payment record to API shape ──
function mapPayment(item) {
  return {
    sort_key: item.interestPaidTo,
    date_received: item.date_received,
    payment: item.payment,
    details: item.details,
    status: item.status,
    disbursements: item.disbursements,
    metadata: item.metadata,
  };
}

function isAccountClosed(account, latestBalance) {
  if (typeof account.is_closed_override === 'boolean') return account.is_closed_override;
  return latestBalance != null && latestBalance <= 0;
}

function buildInvestment(account, payments) {
  const inv = computeInvestment(payments);
  if (account.principal_override != null) {
    return { ...inv, estimated_investment: account.principal_override, is_overridden: true };
  }
  return { ...inv, is_overridden: false };
}

// ── GET /api/accounts — list with investment summary ──
app.get('/api/accounts', async (req, res) => {
  try {
    const [accounts, allPayments] = await Promise.all([
      listAccounts(req.userId),
      listAllPayments(req.userId),
    ]);

    const byAccount = {};
    for (const a of accounts) byAccount[a.accountNumber] = { ...a, payments: [] };
    for (const p of allPayments) {
      const [, acct] = p.acctKey.split('#');
      if (!byAccount[acct]) continue; // orphan payment (shouldn't happen)
      byAccount[acct].payments.push(mapPayment(p));
    }

    const result = Object.values(byAccount).map(a => {
      a.payments.sort((x, y) => new Date(x.sort_key) - new Date(y.sort_key));
      const latest = a.payments[a.payments.length - 1];
      const currentBalance = latest?.status?.current_balance ?? null;
      return {
        account_number: a.accountNumber,
        payor: a.payor || '',
        recipient: a.recipient || '',
        company: a.company || '',
        property_address: a.property_address || null,
        current_balance: currentBalance,
        next_due_date: latest?.status?.next_due_date ?? null,
        late_owed: latest?.status?.late_owed ?? 0,
        is_closed: isAccountClosed(a, currentBalance),
        investment: buildInvestment(a, a.payments),
      };
    });
    res.json(result);
  } catch (err) {
    console.error('GET /api/accounts failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/accounts/:accountNumber ──
app.get('/api/accounts/:accountNumber', async (req, res) => {
  try {
    const [account, payments] = await Promise.all([
      getAccount(req.userId, req.params.accountNumber),
      listPayments(req.userId, req.params.accountNumber),
    ]);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const mapped = payments.map(mapPayment).sort(
      (a, b) => new Date(a.sort_key) - new Date(b.sort_key),
    );
    res.json({
      account_number: account.accountNumber,
      payor: account.payor || '',
      recipient: account.recipient || '',
      company: account.company || '',
      property_address: account.property_address || null,
      payments: mapped,
      investment: buildInvestment(account, mapped),
    });
  } catch (err) {
    console.error(`GET /api/accounts/${req.params.accountNumber} failed`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/payment-grid ──
app.get('/api/payment-grid', async (req, res) => {
  try {
    const [accounts, allPayments, cellOverrides] = await Promise.all([
      listAccounts(req.userId),
      listAllPayments(req.userId),
      listAllCellOverrides(req.userId),
    ]);

    const byAccount = {};
    for (const a of accounts) byAccount[a.accountNumber] = { meta: a, payments: [] };
    for (const p of allPayments) {
      const [, acct] = p.acctKey.split('#');
      if (!byAccount[acct]) continue;
      const ipt = p.status?.interest_paid_to;
      const dr = p.date_received;
      const refDate = ipt || dr;
      if (!refDate) continue;
      const d = new Date(refDate);
      byAccount[acct].payments.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        date_received: dr,
        interest_paid_to: ipt || null,
        amount: p.payment ?? 0,
        balance: p.status?.current_balance ?? null,
      });
    }

    const now = new Date();
    let earliest = now;
    for (const rec of Object.values(byAccount)) {
      rec.payments.sort((a, b) => new Date(a.date_received) - new Date(b.date_received));
      for (const pp of rec.payments) {
        const d = new Date(pp.year, pp.month, 1);
        if (d < earliest) earliest = d;
      }
    }

    const months = [];
    const cursor = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    while (cursor <= now) {
      months.push({
        year: cursor.getFullYear(),
        month: cursor.getMonth(),
        label: cursor.toLocaleDateString('en-US', { year: 'numeric', month: 'short' }),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const coByKey = {};
    for (const c of cellOverrides) {
      const [, acct] = c.acctKey.split('#');
      coByKey[`${acct}:${c.yearMonth}`] = c;
    }

    const rows = Object.values(byAccount).map(({ meta, payments }) => {
      const paidSet = new Set(payments.map(p => `${p.year}-${p.month}`));
      const cells = months.map(m => {
        const key = `${m.year}-${m.month}`;
        const payment = payments.find(p => p.year === m.year && p.month === m.month);
        const co = coByKey[`${meta.accountNumber}:${key}`];
        return {
          year: m.year,
          month: m.month,
          paid: co?.status === 'paid' ? true : co?.status === 'missing' ? false : paidSet.has(key),
          amount: payment?.amount ?? null,
          date_received: payment?.date_received ?? null,
          interest_paid_to: payment?.interest_paid_to ?? null,
          override: co?.status ?? null,
          note: co?.note ?? null,
        };
      });
      const first = payments[0];
      const last = payments[payments.length - 1];
      return {
        account_number: meta.accountNumber,
        payor: meta.payor || '',
        first_year: first?.year ?? null,
        first_month: first?.month ?? null,
        is_closed: isAccountClosed(meta, last?.balance ?? null),
        cells,
      };
    });

    res.json({ months, rows });
  } catch (err) {
    console.error('GET /api/payment-grid failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/accounts/:accountNumber/status — manual close/reopen ──
app.put('/api/accounts/:accountNumber/status', async (req, res) => {
  const { closed } = req.body || {};
  if (typeof closed !== 'boolean') {
    return res.status(400).json({ error: 'Body must include { closed: true|false }' });
  }
  try {
    await updateAccountClosed(req.userId, req.params.accountNumber, closed);
    res.json({ account_number: req.params.accountNumber, closed });
  } catch (err) {
    console.error('PUT /api/accounts/.../status failed', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/accounts/:accountNumber/status', async (req, res) => {
  try {
    await deleteAccountClosedOverride(req.userId, req.params.accountNumber);
    res.json({ account_number: req.params.accountNumber, override: 'removed' });
  } catch (err) {
    console.error('DELETE /api/accounts/.../status failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/accounts/:accountNumber/principal — manual investment override ──
app.put('/api/accounts/:accountNumber/principal', async (req, res) => {
  const value = Number(req.body?.value);
  if (!isFinite(value) || value < 0) {
    return res.status(400).json({ error: 'value must be a non-negative number' });
  }
  try {
    await updateAccountPrincipalOverride(req.userId, req.params.accountNumber, value);
    res.json({ account_number: req.params.accountNumber, principal_override: value });
  } catch (err) {
    console.error('PUT /api/accounts/.../principal failed', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/accounts/:accountNumber/principal', async (req, res) => {
  try {
    await deleteAccountPrincipalOverride(req.userId, req.params.accountNumber);
    res.json({ account_number: req.params.accountNumber, principal_override: null });
  } catch (err) {
    console.error('DELETE /api/accounts/.../principal failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/accounts/:accountNumber ──
app.delete('/api/accounts/:accountNumber', async (req, res) => {
  try {
    await deleteAccount(req.userId, req.params.accountNumber);
    res.json({ deleted: true, account_number: req.params.accountNumber });
  } catch (err) {
    console.error('DELETE /api/accounts/... failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/accounts/:accountNumber/payments/:sortKey ──
app.delete('/api/accounts/:accountNumber/payments/:sortKey', async (req, res) => {
  const sortKey = decodeURIComponent(req.params.sortKey);
  try {
    await deletePayment(req.userId, req.params.accountNumber, sortKey);
    res.json({ deleted: true, account_number: req.params.accountNumber, sort_key: sortKey });
  } catch (err) {
    console.error('DELETE /api/accounts/.../payments/... failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/cells/:accountNumber/:year/:month — cell override + note ──
app.put('/api/cells/:accountNumber/:year/:month', async (req, res) => {
  const { status, note } = req.body || {};
  const valid = ['paid', 'missing', 'na', null, undefined];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'status must be paid, missing, na, or null' });
  }
  const acctKey = `${req.userId}#${req.params.accountNumber}`;
  const yearMonth = `${req.params.year}-${req.params.month}`;
  const trimmedNote = (note || '').trim();
  try {
    if (!status && !trimmedNote) {
      await deleteCellOverride(req.userId, req.params.accountNumber, yearMonth);
      return res.json({ removed: true, key: `${req.params.accountNumber}:${yearMonth}` });
    }
    const item = {
      acctKey,
      yearMonth,
      status: status || null,
      note: trimmedNote || null,
      updated_at: new Date().toISOString(),
    };
    await putCellOverride(item);
    res.json({ key: `${req.params.accountNumber}:${yearMonth}`, ...item });
  } catch (err) {
    console.error('PUT /api/cells/... failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cells/:accountNumber ──
app.get('/api/cells/:accountNumber', async (req, res) => {
  try {
    const items = await listCellOverrides(req.userId, req.params.accountNumber);
    const result = {};
    for (const c of items) {
      const key = `${req.params.accountNumber}:${c.yearMonth}`;
      result[key] = { status: c.status, note: c.note, updated_at: c.updated_at };
    }
    res.json(result);
  } catch (err) {
    console.error('GET /api/cells/... failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/upload — push files to S3; parser Lambda picks them up ──
app.post('/api/upload', upload.array('files'), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const results = [];
  const ts = Date.now();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const key = `${req.userId}/inbound/${ts}-${i}-${f.originalname}`;
    try {
      await s3.send(new PutObjectCommand({
        Bucket: EMAIL_BUCKET,
        Key: key,
        Body: f.buffer,
        ContentType: f.mimetype || 'application/octet-stream',
        Metadata: { uploader: req.userId, originalname: f.originalname },
      }));
      results.push({ name: f.originalname, ok: true, key });
    } catch (err) {
      console.error('S3 upload failed', err);
      results.push({ name: f.originalname, ok: false, error: err.message });
    }
  }
  res.json({ uploaded: results.length, results });
});

module.exports = app;

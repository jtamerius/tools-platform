import { useState, useEffect } from 'react';
import { useAuth } from '@tools/auth'; // eslint-disable-line
import LoginScreen from './components/LoginScreen';
import Sidebar from './components/Sidebar';
import MonthSelector from './components/MonthSelector';
import PaymentTable from './components/PaymentTable';
import AccountDetails from './components/AccountDetails';
import StatusBadge from './components/StatusBadge';
import PaymentGrid from './components/PaymentGrid';
import BatchUpload from './components/BatchUpload';
import { fetchAccounts, fetchAccount, setAccountClosed, fetchCellOverrides, fetchMe, setPrincipalOverride, deletePrincipalOverride, deletePayment, deleteAccount } from './services/api';
import './App.css';

const AUTH_CONFIG = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
};

export default function App() {
  const { user, isLoading: authLoading, signIn, signOut, completeNewPasswordChallenge } = useAuth(AUTH_CONFIG);
  const [accounts, setAccounts] = useState([]);
  const [inboundEmail, setInboundEmail] = useState(null);
  const [selectedAcct, setSelectedAcct] = useState(null);
  const [accountDetail, setAccountDetail] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('grid'); // 'grid' or 'detail'
  const [showClosed, setShowClosed] = useState(false);
  const [cellNotes, setCellNotes] = useState({});
  const [editingInvestment, setEditingInvestment] = useState(false);
  const [investmentInput, setInvestmentInput] = useState('');
  const [deleteError, setDeleteError] = useState(null);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      fetchAccounts(),
      fetchMe().then(d => setInboundEmail(d.inbound_email)).catch(() => {}),
    ]).then(([data]) => {
      setAccounts(data);
      const open = data.filter(a => !a.is_closed);
      if (open.length > 0) setSelectedAcct(open[0].account_number);
      else if (data.length > 0) setSelectedAcct(data[0].account_number);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!selectedAcct) return;
    fetchAccount(selectedAcct).then(data => {
      setAccountDetail(data);
      setSelectedMonth(null);
    });
    fetchCellOverrides(selectedAcct).then(setCellNotes);
    setEditingInvestment(false);
    setDeleteError(null);
  }, [selectedAcct]);

  const months =
    accountDetail?.payments?.map(p => {
      const key = p.sort_key;
      const d = new Date(key);
      return {
        key,
        label: d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      };
    }) || [];

  const currentPayment = selectedMonth
    ? accountDetail?.payments?.find(p => p.sort_key === selectedMonth)
    : accountDetail?.payments?.[accountDetail.payments.length - 1];

  // Find note for current payment
  const currentNote = (() => {
    if (!currentPayment || !selectedAcct) return null;
    const ipt = currentPayment.status?.interest_paid_to || currentPayment.date_received;
    if (!ipt) return null;
    const d = new Date(ipt);
    const key = `${selectedAcct}:${d.getFullYear()}-${d.getMonth()}`;
    return cellNotes[key]?.note || null;
  })();

  const handleGridSelect = acctNum => {
    setSelectedAcct(acctNum);
    setView('detail');
  };

  const refreshAccounts = () => fetchAccounts().then(setAccounts);

  const currentAcctInfo = accounts.find(a => a.account_number === selectedAcct);

  const handleToggleClosed = async () => {
    if (!selectedAcct || !currentAcctInfo) return;
    const newClosed = !currentAcctInfo.is_closed;
    await setAccountClosed(selectedAcct, newClosed);
    await refreshAccounts();
  };

  const handleSavePrincipal = async () => {
    const value = parseFloat(investmentInput.replace(/[^0-9.]/g, ''));
    if (!isFinite(value) || !selectedAcct) return;
    await setPrincipalOverride(selectedAcct, value);
    const updated = await fetchAccount(selectedAcct);
    setAccountDetail(updated);
    setEditingInvestment(false);
  };

  const handleDeletePayment = async () => {
    if (!currentPayment || !selectedAcct) return;
    try {
      await deletePayment(selectedAcct, currentPayment.sort_key);
      const updated = await fetchAccount(selectedAcct);
      setAccountDetail(updated);
      setSelectedMonth(null);
      await refreshAccounts();
    } catch (err) {
      setDeleteError(err.message);
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedAcct) return;
    try {
      await deleteAccount(selectedAcct);
      setSelectedAcct(null);
      setAccountDetail(null);
      setView('grid');
      await refreshAccounts();
    } catch (err) {
      setDeleteError(err.message);
    }
  };

  const handleClearPrincipal = async () => {
    if (!selectedAcct) return;
    await deletePrincipalOverride(selectedAcct);
    const updated = await fetchAccount(selectedAcct);
    setAccountDetail(updated);
    setEditingInvestment(false);
  };

  if (authLoading) {
    return <div className="loading"><p>Loading…</p></div>;
  }

  if (!user) {
    return <LoginScreen onSignIn={signIn} onCompleteNewPassword={completeNewPasswordChallenge} />;
  }

  if (loading) {
    return (
      <div className="loading">
        <p>Loading investments…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        accounts={accounts}
        selected={selectedAcct}
        showClosed={showClosed}
        onSelect={acct => {
          setSelectedAcct(acct);
          setView('detail');
        }}
      />
      <main className="main">
        <nav className="view-tabs">
          <button
            className={view === 'grid' ? 'active' : ''}
            onClick={() => setView('grid')}
          >
            Payment Overview
          </button>
          <button
            className={view === 'detail' ? 'active' : ''}
            onClick={() => setView('detail')}
          >
            Account Detail
          </button>
          <button
            className={view === 'upload' ? 'active' : ''}
            onClick={() => setView('upload')}
          >
            Upload
          </button>
          <label className="closed-toggle">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={e => setShowClosed(e.target.checked)}
            />
            Show closed
          </label>
          <button className="signout-btn" onClick={signOut}>{user.email}</button>
        </nav>

        {view === 'grid' && (
          <PaymentGrid onSelectAccount={handleGridSelect} showClosed={showClosed} />
        )}

        {view === 'detail' && accountDetail && (
          <>
            <header className="main-header">
              <div className="main-header-info">
                <h1>{accountDetail.payor}</h1>
                <p className="payor">{accountDetail.account_number}</p>
                {accountDetail.property_address && (
                  <p className="address">{accountDetail.property_address}</p>
                )}
              </div>
              <div className="main-header-actions">
                {editingInvestment ? (
                  <div className="inv-edit">
                    <span className="inv-edit-label">My Investment ($)</span>
                    <input
                      className="inv-edit-input"
                      type="number"
                      min="0"
                      value={investmentInput}
                      onChange={e => setInvestmentInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSavePrincipal(); if (e.key === 'Escape') setEditingInvestment(false); }}
                      autoFocus
                    />
                    <div className="inv-edit-btns">
                      <button onClick={handleSavePrincipal}>Save</button>
                      <button onClick={() => setEditingInvestment(false)}>Cancel</button>
                      {accountDetail.investment?.is_overridden && (
                        <button className="inv-reset-btn" onClick={handleClearPrincipal}>Reset to calculated</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    className="header-investment"
                    title="Click to set a manual value"
                    onClick={() => { setInvestmentInput(String(accountDetail.investment?.estimated_investment ?? 0)); setEditingInvestment(true); }}
                  >
                    <span className="inv-amount">
                      ${(Math.round((accountDetail.investment?.estimated_investment ?? 0) / 1000) * 1000).toLocaleString()}
                      {accountDetail.investment?.is_overridden && <span className="inv-override-dot" title="Manual override">✎</span>}
                    </span>
                    <span className="inv-label">
                      My Investment · {accountDetail.investment?.ownership_pct ?? 0}%
                    </span>
                  </div>
                )}
                <StatusBadge payment={currentPayment} />
                <button
                  className={`close-acct-btn ${currentAcctInfo?.is_closed ? 'reopen' : 'close'}`}
                  onClick={handleToggleClosed}
                >
                  {currentAcctInfo?.is_closed ? 'Reopen' : 'Close'}
                </button>
                <button className="delete-acct-btn" onClick={handleDeleteAccount}>Delete</button>
              </div>
            </header>

            <MonthSelector
              months={months}
              selected={selectedMonth || currentPayment?.date_received}
              onSelect={setSelectedMonth}
            />

            {currentNote && (
              <div className="payment-note">
                <span className="note-icon">📝</span>
                {currentNote}
              </div>
            )}

            {currentPayment && (
              <>
                <PaymentTable payment={currentPayment} />
                <AccountDetails
                  payment={currentPayment}
                  account={accountDetail}
                />
                <div className="payment-delete-row">
                  {confirmDeletePayment ? (
                    <>
                      <button className="delete-payment-btn confirm" onClick={handleDeletePayment}>Sure?</button>
                      <button className="delete-payment-btn" onClick={() => setConfirmDeletePayment(false)}>Cancel</button>
                    </>
                  ) : (
                    <button className="delete-payment-btn" onClick={() => setConfirmDeletePayment(true)}>Delete this payment</button>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {view === 'upload' && (
          <BatchUpload inboundEmail={inboundEmail} onUploadComplete={() => {
            fetchAccounts().then(setAccounts);
          }} />
        )}
      </main>
    </div>
  );
}

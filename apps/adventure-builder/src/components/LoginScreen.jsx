import { useState } from 'react';
import './LoginScreen.css';

export default function LoginScreen({ onSignIn, onCompleteNewPassword }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [newPasswordChallenge, setNewPasswordChallenge] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSignIn(email, password);
    } catch (err) {
      if (err.code === 'NewPasswordRequired' && err.cognitoUser) {
        setNewPasswordChallenge(err.cognitoUser);
      } else {
        setError(err.message || 'Sign-in failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleNewPassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    setBusy(true);
    setError(null);
    try {
      await onCompleteNewPassword(newPasswordChallenge, newPassword);
    } catch (err) {
      setError(err.message || 'Failed to set new password');
    } finally {
      setBusy(false);
    }
  };

  if (newPasswordChallenge) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handleNewPassword}>
          <h2>Adventure Builder</h2>
          <input type="password" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" required />
          <input type="password" placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
          {error && <p className="login-error">{error}</p>}
          <button className="login-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set Password'}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h2>Adventure Builder</h2>
        <input autoFocus type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <p className="login-error">{error}</p>}
        <button className="login-btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</button>
      </form>
    </div>
  );
}

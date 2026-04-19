import { useState } from 'react';
import './LoginScreen.css';

export default function LoginScreen({ onSignIn, onCompleteNewPassword, error: externalError }) {
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
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
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
          <h1>Investment Tracker</h1>
          <p className="subtitle">Set a new password to continue</p>

          {(error || externalError) && (
            <div className="login-error">{error || externalError}</div>
          )}

          <label htmlFor="new-password">New Password</label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
          />

          <label htmlFor="confirm-password">Confirm Password</label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />

          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set Password'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Investment Tracker</h1>
        <p className="subtitle">Sign in to continue</p>

        {(error || externalError) && (
          <div className="login-error">{error || externalError}</div>
        )}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

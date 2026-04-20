import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';

function getSharedDomain() {
  const hostname = window.location.hostname
  if (hostname === 'localhost' || hostname === '127.0.0.1') return null
  const parts = hostname.split('.')
  if (parts.length >= 2 && parts.slice(-2).join('.') === 'jtamerius.com') {
    return '.jtamerius.com'
  }
  return null
}

class SharedCookieStorage {
  constructor(domain) { this._domain = domain }

  setItem(key, value) {
    const expires = new Date()
    expires.setDate(expires.getDate() + 365)
    const parts = [
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      `expires=${expires.toUTCString()}`,
      `path=/`,
      `SameSite=Strict`,
      `Secure`,
    ]
    if (this._domain) parts.push(`domain=${this._domain}`)
    document.cookie = parts.join('; ')
  }

  getItem(key) {
    const enc = encodeURIComponent(key)
    for (const c of document.cookie.split(';')) {
      const trimmed = c.trim()
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      if (trimmed.slice(0, eq) === enc) return decodeURIComponent(trimmed.slice(eq + 1))
    }
    // One-time migration: fall back to localStorage for sessions stored before
    // the cookie-based SSO was deployed.
    try {
      const lsVal = localStorage.getItem(key)
      if (lsVal !== null) return lsVal
    } catch {}
    return null
  }

  removeItem(key) {
    const parts = [
      `${encodeURIComponent(key)}=`,
      `expires=Thu, 01 Jan 1970 00:00:00 GMT`,
      `path=/`,
      `SameSite=Strict`,
      `Secure`,
    ]
    if (this._domain) parts.push(`domain=${this._domain}`)
    document.cookie = parts.join('; ')
  }

  clear() {
    document.cookie.split(';').forEach(c => {
      const trimmed = c.trim()
      const eq = trimmed.indexOf('=')
      const key = decodeURIComponent(eq === -1 ? trimmed : trimmed.slice(0, eq))
      if (key.includes('CognitoIdentityServiceProvider')) this.removeItem(key)
    })
  }
}

/**
 * Creates and returns a CognitoUserPool instance.
 * @param {string} userPoolId - The Cognito User Pool ID (e.g. us-east-1_XXXXXXXXX)
 * @param {string} clientId - The Cognito App Client ID
 * @returns {CognitoUserPool}
 */
export function createUserPool(userPoolId, clientId) {
  const domain = getSharedDomain()
  return new CognitoUserPool({
    UserPoolId: userPoolId,
    ClientId: clientId,
    ...(domain ? { Storage: new SharedCookieStorage(domain) } : {}),
  });
}

/**
 * Returns the current authenticated session, or null if no session exists.
 * @param {CognitoUserPool} userPool
 * @returns {Promise<import('amazon-cognito-identity-js').CognitoUserSession | null>}
 */
export function getCurrentSession(userPool) {
  return new Promise((resolve) => {
    const user = userPool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err, session) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
      } else {
        resolve(session);
      }
    });
  });
}

/**
 * Signs in a user with email and password.
 * @param {CognitoUserPool} userPool
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ user: CognitoUser, session: import('amazon-cognito-identity-js').CognitoUserSession }>}
 */
export function signIn(userPool, email, password) {
  return new Promise((resolve, reject) => {
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool,
    });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess(session) {
        resolve({ user: cognitoUser, session });
      },
      onFailure(err) {
        reject(err);
      },
      newPasswordRequired(_userAttributes, _requiredAttributes) {
        reject(
          Object.assign(new Error('New password required.'), {
            code: 'NewPasswordRequired',
            cognitoUser,
          })
        );
      },
    });
  });
}

/**
 * Signs out the currently authenticated user (local sign-out).
 * @param {CognitoUserPool} userPool
 * @returns {void}
 */
export function signOut(userPool) {
  const user = userPool.getCurrentUser();
  if (user) {
    user.signOut();
  }
}

/**
 * Extracts the list of Cognito groups the user belongs to from the ID token.
 * @param {import('amazon-cognito-identity-js').CognitoUserSession} session
 * @returns {string[]}
 */
export function getGroupsFromToken(session) {
  const payload = session.getIdToken().decodePayload();
  return payload['cognito:groups'] ?? [];
}

/**
 * Returns the current ID token JWT string, or null if there is no valid session.
 * Triggers a silent refresh if the cached token is expired.
 * @param {CognitoUserPool} userPool
 * @returns {Promise<string | null>}
 */
export async function getIdTokenJwt(userPool) {
  const session = await getCurrentSession(userPool);
  if (!session) return null;
  return session.getIdToken().getJwtToken();
}

/**
 * Extracts basic user attributes (email, sub) from the ID token payload.
 * @param {import('amazon-cognito-identity-js').CognitoUserSession} session
 * @returns {{ email: string, sub: string }}
 */
export function getUserAttributesFromToken(session) {
  const payload = session.getIdToken().decodePayload();
  return {
    email: payload['email'] ?? '',
    sub: payload['sub'] ?? '',
  };
}

/**
 * Initiates the forgot-password flow by sending a verification code to the
 * user's registered email address.
 * @param {CognitoUserPool} userPool
 * @param {string} email
 * @returns {Promise<void>}
 */
export function forgotPassword(userPool, email) {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    cognitoUser.forgotPassword({
      onSuccess() { resolve(); },
      onFailure(err) { reject(err); },
    });
  });
}

/**
 * Completes the NEW_PASSWORD_REQUIRED challenge for admin-created users.
 * @param {import('amazon-cognito-identity-js').CognitoUser} cognitoUser - The user object from the signIn error
 * @param {string} newPassword
 * @returns {Promise<{ user: CognitoUser, session: import('amazon-cognito-identity-js').CognitoUserSession }>}
 */
export function completeNewPassword(cognitoUser, newPassword) {
  return new Promise((resolve, reject) => {
    cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess(session) {
        resolve({ user: cognitoUser, session });
      },
      onFailure(err) {
        reject(err);
      },
    });
  });
}

/**
 * Completes the forgot-password flow by submitting the verification code and
 * the new password chosen by the user.
 * @param {CognitoUserPool} userPool
 * @param {string} email
 * @param {string} code   - The verification code sent to the user's email
 * @param {string} newPassword
 * @returns {Promise<void>}
 */
export function confirmForgotPassword(userPool, email, code, newPassword) {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    cognitoUser.confirmPassword(code, newPassword, {
      onSuccess() { resolve(); },
      onFailure(err) { reject(err); },
    });
  });
}

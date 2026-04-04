import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';

/**
 * Creates and returns a CognitoUserPool instance.
 * @param {string} userPoolId - The Cognito User Pool ID (e.g. us-east-1_XXXXXXXXX)
 * @param {string} clientId - The Cognito App Client ID
 * @returns {CognitoUserPool}
 */
export function createUserPool(userPoolId, clientId) {
  return new CognitoUserPool({
    UserPoolId: userPoolId,
    ClientId: clientId,
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

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createUserPool,
  getCurrentSession,
  signIn as cognitoSignIn,
  signOut as cognitoSignOut,
  getGroupsFromToken,
  getUserAttributesFromToken,
} from './cognito.js';

// Re-validate the session every 30 minutes. The Cognito SDK automatically
// uses the refresh token to obtain new access/id tokens when they are expired,
// so calling getSession() is sufficient — no manual refresh call needed.
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/**
 * React hook that manages Cognito authentication state.
 *
 * @param {{ userPoolId: string, clientId: string }} config
 * @returns {{
 *   user: { email: string, sub: string } | null,
 *   groups: string[],
 *   isLoading: boolean,
 *   error: Error | null,
 *   signIn: (email: string, password: string) => Promise<void>,
 *   signOut: () => void,
 *   hasGroup: (groupName: string) => boolean,
 *   isAdmin: boolean,
 * }}
 */
export function useAuth({ userPoolId, clientId }) {
  const userPoolRef = useRef(null);

  // Lazily create/reuse the user pool instance.
  if (!userPoolRef.current && userPoolId && clientId) {
    userPoolRef.current = createUserPool(userPoolId, clientId);
  }

  const [user, setUser] = useState(null);
  const [groups, setGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  /** Hydrate state from a valid session object. */
  const hydrateFromSession = useCallback((session) => {
    const attributes = getUserAttributesFromToken(session);
    const sessionGroups = getGroupsFromToken(session);
    setUser(attributes);
    setGroups(sessionGroups);
  }, []);

  /** Clear auth state — used on sign-out and expired sessions. */
  const clearSession = useCallback(() => {
    setUser(null);
    setGroups([]);
  }, []);

  /**
   * Attempt to load (or silently refresh) the current session.
   * Returns true if a valid session was found.
   */
  const loadSession = useCallback(async () => {
    const pool = userPoolRef.current;
    if (!pool) return false;
    try {
      const session = await getCurrentSession(pool);
      if (session) {
        hydrateFromSession(session);
        return true;
      }
    } catch {
      // Swallow refresh errors — treat as signed out.
    }
    clearSession();
    return false;
  }, [hydrateFromSession, clearSession]);

  // Restore session on mount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadSession();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Silently refresh the session on an interval so the UI stays in sync
  // when tokens expire after their 1-hour lifetime.
  useEffect(() => {
    if (!user) return;

    const id = setInterval(() => {
      loadSession();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(id);
  }, [user, loadSession]);

  /**
   * Signs the user in and updates auth state.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<void>}
   */
  const signIn = useCallback(
    async (email, password) => {
      setError(null);
      setIsLoading(true);
      try {
        const pool = userPoolRef.current;
        if (!pool) throw new Error('Cognito is not configured. Check VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.');
        const { session } = await cognitoSignIn(pool, email, password);
        hydrateFromSession(session);
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsLoading(false);
      }
    },
    [hydrateFromSession]
  );

  /**
   * Signs the current user out and clears auth state.
   */
  const signOut = useCallback(() => {
    const pool = userPoolRef.current;
    if (pool) cognitoSignOut(pool);
    clearSession();
    setError(null);
  }, [clearSession]);

  /**
   * Returns true if the current user belongs to the given Cognito group.
   * @param {string} groupName
   * @returns {boolean}
   */
  const hasGroup = useCallback(
    (groupName) => groups.includes(groupName),
    [groups]
  );

  const isAdmin = hasGroup('admin');

  return {
    user,
    groups,
    isLoading,
    error,
    signIn,
    signOut,
    hasGroup,
    isAdmin,
  };
}

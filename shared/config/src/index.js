/** Base domain used across all apps in the platform. */
export const DOMAIN_BASE = 'jtamerius.com';

/**
 * Cognito group names used throughout the platform.
 * @type {{ GUEST: string, MEMBER: string, ADMIN: string }}
 */
export const COGNITO_GROUPS = {
  GUEST: 'guest',
  MEMBER: 'member',
  ADMIN: 'admin',
};

/**
 * Deployment environment identifiers.
 * @type {{ STAGING: string, PRODUCTION: string }}
 */
export const ENVIRONMENTS = {
  STAGING: 'staging',
  PRODUCTION: 'production',
};

/**
 * Returns the full URL for a given app subdomain and environment.
 * - staging:    https://subdomain.staging.jtamerius.com
 * - production: https://subdomain.jtamerius.com
 *
 * @param {string} subdomain - The app subdomain (e.g. "dashboard")
 * @param {string} env - One of ENVIRONMENTS.STAGING | ENVIRONMENTS.PRODUCTION
 * @returns {string}
 */
export function getAppUrl(subdomain, env) {
  if (env === ENVIRONMENTS.STAGING) {
    return `https://${subdomain}.staging.${DOMAIN_BASE}`;
  }
  return `https://${subdomain}.${DOMAIN_BASE}`;
}

/**
 * Returns true if the app is marked as publicly accessible.
 * @param {{ isPublic?: boolean }} app
 * @returns {boolean}
 */
export function isPublicApp(app) {
  return app.isPublic === true;
}

/**
 * Returns true if the user can access the app.
 * Access is granted when:
 *   - the app is public, OR
 *   - the user belongs to a group listed in app.requiredGroups (falls back to
 *     allowing any authenticated user when requiredGroups is absent/empty).
 *
 * @param {{ isPublic?: boolean, requiredGroups?: string[] }} app
 * @param {string[]} groups - Groups the current user belongs to
 * @returns {boolean}
 */
export function canAccessApp(app, groups) {
  if (isPublicApp(app)) {
    return true;
  }

  // If no specific groups are required, any authenticated user may access it.
  if (!app.requiredGroups || app.requiredGroups.length === 0) {
    return groups.length > 0;
  }

  return app.requiredGroups.some((required) => groups.includes(required));
}

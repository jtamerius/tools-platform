import React from 'react';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

const BUTTON_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: '8px 16px',
  borderRadius: '6px',
  border: 'none',
  fontSize: '14px',
  fontWeight: '500',
  lineHeight: '1.4',
  cursor: 'pointer',
  transition: 'opacity 0.15s ease, background-color 0.15s ease',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const BUTTON_VARIANTS = {
  primary: {
    backgroundColor: '#2563eb',
    color: '#ffffff',
  },
  secondary: {
    backgroundColor: '#f1f5f9',
    color: '#1e293b',
    border: '1px solid #e2e8f0',
  },
  danger: {
    backgroundColor: '#dc2626',
    color: '#ffffff',
  },
};

/**
 * Button component with primary / secondary / danger variants.
 *
 * @param {{
 *   variant?: 'primary' | 'secondary' | 'danger',
 *   disabled?: boolean,
 *   loading?: boolean,
 *   onClick?: React.MouseEventHandler<HTMLButtonElement>,
 *   type?: 'button' | 'submit' | 'reset',
 *   style?: React.CSSProperties,
 *   children: React.ReactNode,
 * }} props
 */
export function Button({
  variant = 'primary',
  disabled = false,
  loading = false,
  onClick,
  type = 'button',
  style,
  children,
  ...rest
}) {
  const isDisabled = disabled || loading;

  const combinedStyle = {
    ...BUTTON_BASE,
    ...BUTTON_VARIANTS[variant],
    ...(isDisabled ? { opacity: 0.55, cursor: 'not-allowed' } : {}),
    ...style,
  };

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
      style={combinedStyle}
      {...rest}
    >
      {loading && <LoadingSpinner size={14} color="currentColor" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

/**
 * Card wrapper with a subtle shadow, border and rounded corners.
 *
 * @param {{
 *   style?: React.CSSProperties,
 *   children: React.ReactNode,
 * }} props
 */
export function Card({ style, children, ...rest }) {
  const cardStyle = {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
    padding: '20px',
    ...style,
  };

  return (
    <div style={cardStyle} {...rest}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const BADGE_VARIANTS = {
  default: { backgroundColor: '#e2e8f0', color: '#475569' },
  public: { backgroundColor: '#dcfce7', color: '#166534' },
  members: { backgroundColor: '#dbeafe', color: '#1e40af' },
  admin: { backgroundColor: '#fef9c3', color: '#854d0e' },
  danger: { backgroundColor: '#fee2e2', color: '#991b1b' },
};

/**
 * Small pill badge for status labels (e.g. "Public", "Members Only").
 *
 * @param {{
 *   variant?: 'default' | 'public' | 'members' | 'admin' | 'danger',
 *   style?: React.CSSProperties,
 *   children: React.ReactNode,
 * }} props
 */
export function Badge({ variant = 'default', style, children, ...rest }) {
  const badgeStyle = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '9999px',
    fontSize: '11px',
    fontWeight: '600',
    lineHeight: '1.6',
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    ...BADGE_VARIANTS[variant],
    ...style,
  };

  return (
    <span style={badgeStyle} {...rest}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// LoadingSpinner
// ---------------------------------------------------------------------------

/**
 * Animated SVG loading spinner.
 *
 * @param {{
 *   size?: number,
 *   color?: string,
 *   style?: React.CSSProperties,
 * }} props
 */
export function LoadingSpinner({ size = 24, color = '#2563eb', style, ...rest }) {
  const spinnerStyle = {
    display: 'inline-block',
    width: size,
    height: size,
    animation: 'spin 0.75s linear infinite',
    ...style,
  };

  return (
    <>
      {/* Inject keyframes once via a <style> tag rendered inline. */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={spinnerStyle}
        aria-label="Loading"
        role="status"
        {...rest}
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke={color}
          strokeWidth="3"
          strokeOpacity="0.25"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </>
  );
}

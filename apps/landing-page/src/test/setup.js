import '@testing-library/react/pure'

// Stub Cognito env vars so components don't error during tests.
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_COGNITO_USER_POOL_ID: 'us-east-1_TESTPOOL',
    VITE_COGNITO_CLIENT_ID: 'test-client-id',
    VITE_ENV: 'test',
  },
})

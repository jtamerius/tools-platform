import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock amazon-cognito-identity-js so tests don't need AWS credentials.
vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: vi.fn().mockImplementation(() => ({
    getCurrentUser: () => null,
  })),
  CognitoUser: vi.fn(),
  AuthenticationDetails: vi.fn(),
}))

import App from '../App'

describe('App', () => {
  it('renders the navigation bar', () => {
    render(<App />)
    expect(screen.getByText('JT')).toBeDefined()
  })

  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByText('Finance Tracker')).toBeDefined()
  })

  it('shows Sign in button when unauthenticated', () => {
    render(<App />)
    expect(screen.getAllByText('Sign in').length).toBeGreaterThan(0)
  })
})

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
    // Nav logo is always present
    expect(screen.getByText('JT')).toBeDefined()
  })

  it('renders nav links for Home, About, and Apps', () => {
    render(<App />)
    expect(screen.getByText('Home')).toBeDefined()
    expect(screen.getByText('About')).toBeDefined()
    expect(screen.getByText('Apps')).toBeDefined()
  })

  it('shows Sign in button when unauthenticated', () => {
    render(<App />)
    expect(screen.getByText('Sign in')).toBeDefined()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from '../pages/Home'

describe('Home', () => {
  it('shows a showcase tile for each featured project', () => {
    render(<MemoryRouter><Home /></MemoryRouter>)
    for (const name of ['Hailstoned', 'Ensemble Weather', 'Purgatory']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeDefined()
    }
  })

  it('links the Purgatory tile to its app and its info page', () => {
    render(<MemoryRouter><Home /></MemoryRouter>)
    const launch = screen.getByRole('link', { name: /launch purgatory/i })
    expect(launch.getAttribute('href')).toBe('https://purg.jtamerius.com')

    const about = screen.getAllByRole('link', { name: /about this project/i })
      .map(a => a.getAttribute('href'))
    expect(about).toContain('/#/apps/purgatory')
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AppInfo from '../pages/AppInfo'
import { APP_INFO } from '../config/appInfo'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/apps/:id" element={<AppInfo />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AppInfo', () => {
  it('renders a page for every app in the info registry', () => {
    for (const [id, info] of Object.entries(APP_INFO)) {
      const { unmount } = renderAt(`/apps/${id}`)
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(info.name)
      expect(screen.getByText(info.tagline)).toBeDefined()
      expect(screen.getByText(info.host)).toBeDefined()
      expect(screen.getByText(info.status)).toBeDefined()
      // Every pipeline step and fact label shows up
      for (const step of info.pipeline) expect(screen.getByText(step.label)).toBeDefined()
      for (const fact of info.facts) expect(screen.getByText(fact.label)).toBeDefined()
      unmount()
    }
  })

  it('shows a launch link pointing at the app', () => {
    renderAt('/apps/purgatory')
    const launch = screen.getByRole('link', { name: /launch/i })
    expect(launch.getAttribute('href')).toContain('http')
  })

  it('links the Hailstoned data sources out to their sources', () => {
    renderAt('/apps/hailstoned')
    expect(screen.getByRole('link', { name: 'USPVDB' }).getAttribute('href'))
      .toContain('usgs.gov')
    expect(screen.getByRole('link', { name: 'DeepSolar' }).getAttribute('href'))
      .toContain('stanford.edu')
  })

  it('never leaks internal bucket or resource names into public copy', () => {
    const blob = JSON.stringify(APP_INFO)
    for (const leak of ['s3://', 'jtamerius-', 'execute-api', 'amplifyapp', 'arn:']) {
      expect(blob).not.toContain(leak)
    }
  })

  it('says Purgatory is still only collecting data', () => {
    renderAt('/apps/purgatory')
    expect(screen.getByText(/Early — collecting data/)).toBeDefined()
    expect(screen.getByText(/no crowding prediction yet/i)).toBeDefined()
    expect(screen.getByText('Data collection only, no model yet')).toBeDefined()
  })

  it('renders a not-found page for an unknown id', () => {
    renderAt('/apps/nope')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('No such app')
  })
})

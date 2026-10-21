import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { config, jsonResponse, profile, result } from './test/fixtures'

function mockServer(overrides: Record<string, () => Response> = {}) {
  const calls: { url: string; body?: FormData }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    calls.push({ url, body: init?.body as FormData | undefined })
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    if (overrides[path]) return overrides[path]()
    if (path === '/api/config') return jsonResponse(config)
    if (path === '/api/samples') return jsonResponse([{ id: 'retail-sales', file_name: 'retail_sales.csv', title: 'Retail sales (CSV)', description: 'Synthetic.' }])
    if (path === '/api/samples/retail-sales') return new Response('a,b\n1,2\n', { status: 200 })
    if (path === '/api/profile') return jsonResponse(profile)
    if (path === '/api/analyze') return jsonResponse(result)
    if (path === '/api/narrative') return jsonResponse({ error: { code: 'ai_disabled', message: 'AI commentary is not enabled.' } }, 503)
    return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
  })
  return calls
}

describe('App', () => {
  it('opens a sign-in dialog with Google and GitHub options', async () => {
    const user = userEvent.setup()
    mockServer()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeInTheDocument()
  })

  it('shows the GitHub logo with the star count from the backend', async () => {
    mockServer({
      '/api/github': () => jsonResponse({ repo: 'ShiwamMishra-0599k/tabulavibe-ai', url: 'https://github.com/ShiwamMishra-0599k/tabulavibe-ai', stars: 1234 }),
    })
    render(<App />)
    const link = await screen.findByRole('link', { name: 'TabulaVibe AI on GitHub, 1,234 stars' })
    expect(link).toHaveAttribute('href', 'https://github.com/ShiwamMishra-0599k/tabulavibe-ai')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('1.2K')
  })

  it('hides the GitHub badge when the repo is not configured or unreachable', async () => {
    mockServer({ '/api/github': () => jsonResponse({ repo: null, url: null, stars: null }) })
    render(<App />)
    await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' })
    expect(screen.queryByRole('link', { name: /on GitHub/ })).not.toBeInTheDocument()
  })

  it('walks through sample → preview → quality → analysis → report', async () => {
    const user = userEvent.setup()
    mockServer()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
    expect(await screen.findByText('First 2 of 10 rows')).toBeInTheDocument()
    expect(screen.getByLabelText('Data preview table')).toHaveTextContent('North')

    await user.click(screen.getByRole('tab', { name: '2. Data quality' }))
    expect(screen.getByText('1 row(s) are exact duplicates of an earlier row.')).toBeInTheDocument()
    expect(screen.getByText(/Nothing has been changed in your data/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '3. Analyse' }))
    expect(screen.getByLabelText('Group by')).toHaveValue('date')
    expect(screen.getByText(/Merge labels that differ only by letter case/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run analysis' }))

    expect(await screen.findByText('16,45,592.43')).toBeInTheDocument()
    expect(screen.getByText(/1 missing or invalid value\(s\) excluded/)).toBeInTheDocument()
    expect(screen.getByText('AI commentary is turned off on this server. Every chart, KPI and export above works without it.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Table$/ }))
    const table = screen.getAllByLabelText('Grouped results table')[0]
    expect(within(table).getByText('South')).toBeInTheDocument()
    expect(within(table).getByText('190')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '4. Report & export' }))
    expect(screen.getByRole('heading', { name: 'Key figures' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print / save as PDF' })).toBeInTheDocument()
  })

  it('rejects unsupported files in the browser before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const calls = mockServer()
    render(<App />)
    await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' })
    await user.upload(screen.getByLabelText('Upload CSV or XLSX file'), new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('"notes.txt" is not a supported file')
    expect(calls.some((c) => c.url.includes('/api/profile'))).toBe(false)
  })

  it('applies the smaller Excel limit in the browser and suggests CSV', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const calls = mockServer({ '/api/config': () => jsonResponse({ ...config, limits: { ...config.limits, max_upload_mb: 100, max_xlsx_mb: 0.001 } }) })
    render(<App />)
    expect(await screen.findByText('CSV up to 100 MB')).toBeInTheDocument()
    expect(screen.getByText('Excel up to 0.001 MB')).toBeInTheDocument()
    await user.upload(screen.getByLabelText('Upload CSV or XLSX file'), new File(['x'.repeat(5000)], 'big.xlsx'))
    expect(await screen.findByRole('alert')).toHaveTextContent('limit for Excel files. Save it as CSV to upload up to 100 MB.')
    expect(calls.some((c) => c.url.includes('/api/profile'))).toBe(false)
  })

  it('shows the server validation message when a file is rejected', async () => {
    const user = userEvent.setup()
    mockServer({
      '/api/profile': () => jsonResponse({ error: { code: 'no_data_rows', message: 'The file has column headers but no data rows.' } }, 422),
    })
    render(<App />)
    await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' })
    await user.upload(screen.getByLabelText('Upload CSV or XLSX file'), new File(['a,b\n'], 'empty.csv', { type: 'text/csv' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The file has column headers but no data rows.')
  })

  it('shows a clear message when the server cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    render(<App />)
    expect(await screen.findByText('The server is unavailable')).toBeInTheDocument()
  })

  it('keeps the dashboard usable when AI commentary fails', async () => {
    const user = userEvent.setup()
    mockServer({
      '/api/config': () => jsonResponse({ ...config, ai: { enabled: true, provider: 'gemini', model: 'test' } }),
      '/api/narrative': () => jsonResponse({ error: { code: 'ai_quota_exceeded', message: 'The free usage limit has been reached.' } }, 429),
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
    await user.click(await screen.findByRole('tab', { name: '3. Analyse' }))
    await user.click(screen.getByRole('button', { name: 'Run analysis' }))
    await user.click(await screen.findByRole('button', { name: 'Generate commentary' }))
    expect(await screen.findByText('The free usage limit has been reached.')).toBeInTheDocument()
    expect(screen.getByText('16,45,592.43')).toBeInTheDocument()
  })

  it('disables Run analysis while the spec is invalid', async () => {
    const user = userEvent.setup()
    mockServer()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
    await user.click(await screen.findByRole('tab', { name: '3. Analyse' }))
    await user.selectOptions(screen.getByLabelText('Add a filter'), 'region')
    for (const value of ['East', 'North', 'South', 'West']) await user.click(screen.getByRole('checkbox', { name: value }))
    expect(screen.getByText("Select at least one value for the 'region' filter, or remove it.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run analysis' })).toBeDisabled()
  })

  it('runs a suggested analysis with one click', async () => {
    const user = userEvent.setup()
    const calls = mockServer()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
    await user.click(await screen.findByRole('tab', { name: '3. Analyse' }))
    await user.click(screen.getByRole('button', { name: /revenue by region/ }))
    expect(await screen.findByText('16,45,592.43')).toBeInTheDocument()
    const analyze = calls.find((c) => c.url.endsWith('/api/analyze'))!
    expect(JSON.parse(analyze.body!.get('spec') as string)).toMatchObject({ group_by: 'region', measures: [{ column: 'revenue', aggregation: 'sum' }] })
  })

  it('shows the server-calculated data health on the quality step', async () => {
    const user = userEvent.setup()
    mockServer()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
    await user.click(await screen.findByRole('tab', { name: '2. Data quality' }))
    expect(screen.getByRole('img', { name: 'Data health: 97.5%' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'revenue valid values: 90%' })).toBeInTheDocument()
  })

  it('switches and remembers the colour theme', async () => {
    const user = userEvent.setup()
    mockServer()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Dark theme' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('tabulavibe-theme')).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'System theme' }))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

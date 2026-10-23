import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { api, setAccessTokenProvider } from './lib/api'
import { ProviderDisabledError, type AuthState } from './lib/auth'
import { config, jsonResponse, profile, result } from './test/fixtures'

// Supabase Auth is replaced by a controllable fake; the backend is mocked through fetch.
const authMock = vi.hoisted(() => ({
  state: { status: 'signed-out' } as AuthState,
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}))
vi.mock('./lib/auth', async (importOriginal) => ({
  ProviderDisabledError: (await importOriginal<typeof import('./lib/auth')>()).ProviderDisabledError,
  useAuth: () => ({ state: authMock.state, signIn: authMock.signIn, signOut: authMock.signOut, token: async () => 'user-token' }),
}))

const storageConfig = { ...config, storage: { enabled: true, supabase_url: 'https://demo.supabase.co', supabase_anon_key: 'sb_publishable_x' } }
const lockedConfig = { ...config, storage: { ...storageConfig.storage, sign_in_required: true } }
const summary = { id: '7c0c2f52-0000-4000-8000-000000000001', title: 'Revenue by region', source_name: 'sales.csv', source_type: 'csv', row_count: 10, column_count: 7, created_at: '2026-10-21T10:00:00Z' }
const signedIn = (): AuthState => ({
  status: 'signed-in',
  session: { access_token: 'user-token', user: { id: 'u1', email: 'shiwam@gmail.com', user_metadata: { full_name: 'Provider Name' } } } as never,
})

function mockServer(cfg: unknown = storageConfig) {
  const calls: { url: string; init?: RequestInit }[] = []
  let saved: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '')
    calls.push({ url: path, init })
    const method = init?.method ?? 'GET'
    if (path === '/api/config') return jsonResponse(cfg)
    if (path === '/api/samples') return jsonResponse([{ id: 'retail-sales', file_name: 'retail_sales.csv', title: 'Retail sales (CSV)', description: 'Synthetic.' }])
    if (path === '/api/samples/retail-sales') return new Response('a,b\n1,2\n', { status: 200 })
    if (path === '/api/profile') return jsonResponse(profile)
    if (path === '/api/analyze') return jsonResponse(result)
    if (path === '/api/account') return jsonResponse({ id: 'u1', email: 'shiwam@gmail.com', full_name: 'Shiwam Mishra', avatar_url: null, provider: 'google', created_at: '' })
    if (path === '/api/reports' && method === 'POST') {
      saved = [summary]
      return jsonResponse(summary, 201)
    }
    if (path === '/api/reports') return jsonResponse(saved)
    if (path === `/api/reports/${summary.id}` && method === 'DELETE') {
      saved = []
      return new Response(null, { status: 204 })
    }
    if (path === '/api/report/export') return new Response(new Blob(['%PDF-']), { status: 200, headers: { 'Content-Disposition': 'attachment; filename="tabulavibe_q1.pdf"' } })
    if (path === `/api/reports/${summary.id}`)
      return jsonResponse({ ...summary, spec: result.spec, result, quality: { dataset: profile.dataset, issues: profile.issues }, narrative: null, app_version: '0.3.0' })
    return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
  })
  return calls
}

const authHeader = (init?: RequestInit) => new Headers(init?.headers).get('Authorization')

beforeEach(() => {
  authMock.state = { status: 'signed-out' }
  authMock.signIn.mockClear()
})

describe('Accounts and saved reports', () => {
  it('locks uploads and samples until the user signs in, when the server requires it', async () => {
    const user = userEvent.setup()
    const calls = mockServer(lockedConfig)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in to upload your data' })).toBeInTheDocument()
    expect(screen.getByText('Free · Sign in with Google or GitHub')).toBeInTheDocument()
    expect(screen.queryByLabelText('Upload CSV or XLSX file')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Sign in to upload' }))
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close sign in dialog' }))
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.getByRole('heading', { name: 'Create your TabulaVibe account' })).toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/profile')).toBe(false)
  })

  it('unlocks uploads once signed in', async () => {
    authMock.state = signedIn()
    const user = userEvent.setup()
    mockServer(lockedConfig)
    render(<App />)
    expect(await screen.findByLabelText('Upload CSV or XLSX file')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in to upload your data' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
    await user.click(await screen.findByRole('button', { name: 'Manual Analyst' }))
    expect(await screen.findByText('First 2 of 10 rows')).toBeInTheDocument()
  })

  it("sends the signed-in user's token with uploads, and nothing when signed out", async () => {
    const calls = mockServer()
    const file = new File(['a,b\n1,2\n'], 'x.csv', { type: 'text/csv' })
    setAccessTokenProvider(async () => 'fresh-token')
    await api.profile(file)
    setAccessTokenProvider(null)
    await api.profile(file)
    const [withToken, without] = calls.filter((c) => c.url === '/api/profile')
    expect(new Headers(withToken.init?.headers).get('Authorization')).toBe('Bearer fresh-token')
    expect(new Headers(without.init?.headers).has('Authorization')).toBe(false)
  })

  it('keeps the sign-in dialog as a preview when the server has no database configured', async () => {
    const user = userEvent.setup()
    mockServer(config)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(screen.queryByRole('button', { name: 'Sign up' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(screen.getByRole('status')).toHaveTextContent('Google sign-in will be available after OAuth is configured for this app.')
    expect(authMock.signIn).not.toHaveBeenCalled()
  })

  it('signs in from the dialog and signs up from the page, with Google (Gmail) or GitHub', async () => {
    const user = userEvent.setup()
    mockServer()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    await user.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
    expect(authMock.signIn).toHaveBeenCalledWith('github')
    expect(screen.getByRole('status')).toHaveTextContent('Opening GitHub…')

    await user.click(screen.getByRole('button', { name: 'Close sign in dialog' }))
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(screen.getByRole('heading', { name: 'Create your TabulaVibe account' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign up with Google' }))
    expect(authMock.signIn).toHaveBeenLastCalledWith('google')

    const signUp = screen.getByRole('region', { name: 'Create your TabulaVibe account' })
    await user.click(within(signUp).getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('explains when a provider is not switched on yet instead of sending the visitor to an error page', async () => {
    const user = userEvent.setup()
    mockServer()
    authMock.signIn.mockRejectedValueOnce(new ProviderDisabledError('google'))
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Google sign-in isn't switched on yet. Try the other option, or come back soon.")
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeEnabled()
  })

  it('asks a signed-out user to sign in before saving', async () => {
    const user = userEvent.setup()
    mockServer()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
    await user.click(await screen.findByRole('button', { name: 'Manual Analyst' }))
    await user.click(await screen.findByRole('tab', { name: '3. Analyse' }))
    await user.click(screen.getByRole('button', { name: 'Run analysis' }))
    await user.click(await screen.findByRole('tab', { name: '4. Report & export' }))
    await user.click(screen.getByRole('button', { name: 'Sign in to save' }))
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText(/your open file will be closed/)).toBeInTheDocument()
  })

  it('saves, lists, opens and deletes a report for a signed-in user', async () => {
    authMock.state = signedIn()
    const user = userEvent.setup()
    const calls = mockServer()
    render(<App />)
    expect(await screen.findByText('Shiwam Mishra')).toBeInTheDocument() // name from the TabulaVibe profile

    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
    await user.click(await screen.findByRole('button', { name: 'Manual Analyst' }))
    await user.click(await screen.findByRole('tab', { name: '3. Analyse' }))
    await user.click(screen.getByRole('button', { name: 'Run analysis' }))
    await user.click(await screen.findByRole('tab', { name: '4. Report & export' }))
    const title = screen.getByLabelText('Report title')
    await user.clear(title)
    await user.type(title, 'Q1 revenue')
    await user.click(screen.getByRole('button', { name: 'Save to my reports' }))
    expect(await screen.findByText('Saved. Find it any time under My reports.')).toBeInTheDocument()

    const save = calls.find((c) => c.url === '/api/reports' && c.init?.method === 'POST')!
    expect(authHeader(save.init)).toBe('Bearer user-token')
    const body = save.init!.body as FormData
    expect(body.get('title')).toBe('Q1 revenue')
    expect(body.get('file')).toBeInstanceOf(File)
    expect(body.has('narrative')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'My reports' }))
    await user.click(await screen.findByRole('button', { name: 'Open Revenue by region' }))
    expect(await screen.findByText(/Figures were calculated when the report was saved/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Key figures' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'My reports' }))
    await user.click(await screen.findByRole('button', { name: 'Delete Revenue by region' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete Revenue by region' }))
    expect(await screen.findByText('No saved reports yet')).toBeInTheDocument()
    const del = calls.find((c) => c.init?.method === 'DELETE')!
    expect(authHeader(del.init)).toBe('Bearer user-token')
  })

  it('downloads a saved report as PDF straight from My reports, with the stored results and the user token', async () => {
    authMock.state = signedIn()
    URL.createObjectURL = vi.fn(() => 'blob:saved')
    URL.revokeObjectURL = vi.fn()
    const user = userEvent.setup()
    const calls = mockServer()
    render(<App />)
    await screen.findByText('Shiwam Mishra')
    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
    await user.click(await screen.findByRole('button', { name: 'Manual Analyst' }))
    await user.click(await screen.findByRole('tab', { name: '3. Analyse' }))
    await user.click(screen.getByRole('button', { name: 'Run analysis' }))
    await user.click(await screen.findByRole('tab', { name: '4. Report & export' }))
    await user.click(screen.getByRole('button', { name: 'Save to my reports' }))
    await screen.findByText('Saved. Find it any time under My reports.')

    await user.click(screen.getByRole('button', { name: 'My reports' }))
    await user.click(await screen.findByRole('button', { name: 'Download PDF of Revenue by region' }))
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1))
    const fetched = calls.find((c) => c.url === `/api/reports/${summary.id}` && (c.init?.method ?? 'GET') === 'GET')!
    expect(authHeader(fetched.init)).toBe('Bearer user-token')
    const exported = calls.find((c) => c.url === '/api/report/export')!
    const body = JSON.parse(exported.init!.body as string)
    expect([body.format, body.kind]).toEqual(['pdf', 'manual'])
    expect(body.data.result).toEqual(result) // the stored, validated results
  })
})

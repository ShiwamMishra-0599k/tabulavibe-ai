import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { AuthState } from './lib/auth'
import { config, jsonResponse, profile, result } from './test/fixtures'

// Supabase Auth is replaced by a controllable fake; the backend is mocked through fetch.
const authMock = vi.hoisted(() => ({
  state: { status: 'signed-out' } as AuthState,
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}))
vi.mock('./lib/auth', () => ({
  useAuth: () => ({ state: authMock.state, signIn: authMock.signIn, signOut: authMock.signOut, token: async () => 'user-token' }),
}))

const storageConfig = { ...config, storage: { enabled: true, supabase_url: 'https://demo.supabase.co', supabase_anon_key: 'sb_publishable_x' } }
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
    if (path === `/api/reports/${summary.id}`)
      return jsonResponse({ ...summary, spec: result.spec, result, quality: { dataset: profile.dataset, issues: profile.issues }, narrative: null, app_version: '0.3.0' })
    return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
  })
  return calls
}

const authHeader = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Authorization

beforeEach(() => {
  authMock.state = { status: 'signed-out' }
  authMock.signIn.mockClear()
})

describe('Accounts and saved reports', () => {
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

  it('asks a signed-out user to sign in before saving', async () => {
    const user = userEvent.setup()
    mockServer()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
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
})

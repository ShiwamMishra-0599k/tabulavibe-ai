import type { Account, AnalysisResult, AnalysisSpec, AppConfig, Narrative, Profile, RepoInfo, ReportSummary, SampleInfo, SavedReport } from './types'

// Empty in development: Vite proxies /api to the local backend.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: string[]

  constructor(code: string, message: string, status: number, details: string[] = []) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

type TokenProvider = () => Promise<string | null>
let accessToken: TokenProvider | null = null

/** Registered by the auth hook: adds the signed-in user's token to every API request. */
export function setAccessTokenProvider(provider: TokenProvider | null): void {
  accessToken = provider
}

async function withToken(init: RequestInit = {}): Promise<RequestInit> {
  const headers = new Headers(init.headers)
  if (!headers.has('Authorization') && accessToken) {
    const token = await accessToken().catch(() => null)
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  return { ...init, headers }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, await withToken(init))
  } catch {
    throw new ApiError('network_error', 'Could not reach the TabulaVibe server. Check your connection and try again.', 0)
  }
  if (!response.ok) {
    let code = 'http_error'
    let message = `The server returned an error (HTTP ${response.status}).`
    let details: string[] = []
    try {
      const body = await response.json()
      if (body?.error?.message) {
        code = body.error.code ?? code
        message = body.error.message
        details = body.error.details ?? []
      }
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    throw new ApiError(code, message, response.status, details)
  }
  return response
}

/** Reads an NDJSON response line by line as it arrives (falls back to the whole body where streaming is unavailable). */
export async function streamRequest(path: string, init: RequestInit, onLine: (line: string) => void): Promise<void> {
  const response = await request(path, init)
  const reader = response.body?.getReader()
  if (!reader) {
    for (const line of (await response.text()).split('\n')) if (line.trim()) onLine(line)
    return
  }
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) onLine(line)
      newline = buffer.indexOf('\n')
    }
    if (done) break
  }
  if (buffer.trim()) onLine(buffer.trim())
}

function form(file: File, fields: Record<string, unknown> = {}): FormData {
  const data = new FormData()
  data.append('file', file, file.name)
  for (const [key, value] of Object.entries(fields)) data.append(key, JSON.stringify(value))
  return data
}

/** Headers for endpoints that act on the signed-in user's own data. */
function authed(token: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } }
}

export interface DownloadedFile {
  blob: Blob
  filename: string
  headers: Headers
}

function filenameFrom(response: Response, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')
  return match?.[1] ?? fallback
}

export const api = {
  config: async (): Promise<AppConfig> => (await request('/api/config')).json(),
  github: async (): Promise<RepoInfo> => (await request('/api/github')).json(),
  samples: async (): Promise<SampleInfo[]> => (await request('/api/samples')).json(),
  async sampleFile(sample: SampleInfo): Promise<File> {
    const response = await request(`/api/samples/${encodeURIComponent(sample.id)}`)
    const blob = await response.blob()
    return new File([blob], sample.file_name, { type: blob.type })
  },
  profile: async (file: File): Promise<Profile> =>
    (await request('/api/profile', { method: 'POST', body: form(file) })).json(),
  analyze: async (file: File, spec: AnalysisSpec): Promise<AnalysisResult> =>
    (await request('/api/analyze', { method: 'POST', body: form(file, { spec }) })).json(),
  narrative: async (file: File, spec: AnalysisSpec): Promise<Narrative> =>
    (await request('/api/narrative', { method: 'POST', body: form(file, { spec }) })).json(),
  async exportCleaned(file: File, removeDuplicates: boolean, mergeLabelVariants = false): Promise<DownloadedFile> {
    const response = await request('/api/export/cleaned', {
      method: 'POST',
      body: form(file, { options: { remove_duplicates: removeDuplicates, merge_label_variants: mergeLabelVariants } }),
    })
    return { blob: await response.blob(), filename: filenameFrom(response, 'cleaned_data.csv'), headers: response.headers }
  },
  async exportResults(file: File, spec: AnalysisSpec): Promise<DownloadedFile> {
    const response = await request('/api/export/results', { method: 'POST', body: form(file, { spec }) })
    return { blob: await response.blob(), filename: filenameFrom(response, 'results.csv'), headers: response.headers }
  },
  account: async (token: string): Promise<Account> => (await request('/api/account', authed(token))).json(),
  listReports: async (token: string): Promise<ReportSummary[]> => (await request('/api/reports', authed(token))).json(),
  getReport: async (token: string, id: string): Promise<SavedReport> =>
    (await request(`/api/reports/${encodeURIComponent(id)}`, authed(token))).json(),
  async saveReport(token: string, file: File, spec: AnalysisSpec, title: string, narrative: Narrative | null): Promise<ReportSummary> {
    const body = form(file, narrative ? { spec, narrative } : { spec })
    body.append('title', title)
    return (await request('/api/reports', authed(token, { method: 'POST', body }))).json()
  },
  async deleteReport(token: string, id: string): Promise<void> {
    await request(`/api/reports/${encodeURIComponent(id)}`, authed(token, { method: 'DELETE' }))
  },
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

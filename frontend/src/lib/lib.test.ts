import { describe, expect, it, vi } from 'vitest'
import { profile } from '../test/fixtures'
import { api, ApiError } from './api'
import { activityFromEvents, aiAnalystLabel, providerModel, type AgentEvent } from './agent'
import { formatCompact, formatNumber, formatPercent } from './format'
import { defaultSpec, suggestedAnalyses, validateSpec } from './spec'

describe('format', () => {
  it('uses Indian digit grouping and handles missing values', () => {
    expect(formatNumber(1645592.43)).toBe('16,45,592.43')
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(Number.NaN)).toBe('—')
    expect(formatPercent(12.345)).toBe('12.3%')
  })

  it('keeps small numbers exact and compacts large ones', () => {
    expect(formatCompact(261.36)).toBe('261.36')
    expect(formatCompact(403635)).toMatch(/4\.04\s?L/)
  })
})

describe('spec', () => {
  it('builds a default analysis from server suggestions', () => {
    expect(defaultSpec(profile)).toEqual({
      measures: [
        { column: 'revenue', aggregation: 'sum' },
        { column: null, aggregation: 'count' },
      ],
      group_by: 'date',
      time_grain: 'month',
      filters: [],
      remove_duplicates: false,
      merge_label_variants: false,
    })
  })

  it('rejects numeric aggregations on non-numeric columns, duplicates and empty filters', () => {
    const errors = validateSpec(
      {
        ...defaultSpec(profile),
        measures: [
          { column: 'region', aggregation: 'sum' },
          { column: 'revenue', aggregation: 'sum' },
          { column: 'revenue', aggregation: 'sum' },
        ],
        filters: [{ column: 'region', values: [] }, { column: 'date' }],
      },
      profile,
    )
    expect(errors).toEqual([
      "'region' is not numeric, so only Count can be used.",
      'The same measure is selected twice.',
      "Select at least one value for the 'region' filter, or remove it.",
      "Choose a start or end date for the 'date' filter, or remove it.",
    ])
  })

  it('suggests up to three one-click analyses from the schema', () => {
    const suggestions = suggestedAnalyses(profile)
    expect(suggestions.map((s) => s.title)).toEqual(['revenue by month', 'revenue by region', 'Rows per region'])
    expect(suggestions[0].spec).toMatchObject({ measures: [{ column: 'revenue', aggregation: 'sum' }], group_by: 'date', time_grain: 'month' })
    expect(suggestions[2].spec.measures).toEqual([{ column: null, aggregation: 'count' }])
    for (const s of suggestions) expect(validateSpec(s.spec, profile)).toEqual([])
  })

  it('accepts a valid spec', () => {
    expect(validateSpec(defaultSpec(profile), profile)).toEqual([])
  })
})

describe('api', () => {
  it('turns a server error body into an ApiError with the server message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'file_too_large', message: 'The file is larger than the 4 MB limit.' } }), { status: 413 }),
    )
    const error = await api.profile(new File(['a'], 'a.csv')).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'file_too_large', status: 413, message: 'The file is larger than the 4 MB limit.' })
  })

  it('reports network failures in plain language', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.config()).rejects.toMatchObject({ code: 'network_error' })
  })

  it('falls back to a generic message for non-JSON errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(api.config()).rejects.toMatchObject({ message: 'The server returned an error (HTTP 502).' })
  })

  it('sends the analysis spec as a JSON form field with the file', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const spec = defaultSpec(profile)
    await api.analyze(new File(['x'], 'data.csv'), spec)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/analyze')
    const body = init!.body as FormData
    expect((body.get('file') as File).name).toBe('data.csv')
    expect(JSON.parse(body.get('spec') as string)).toEqual(spec)
  })
})

describe('aiAnalystLabel', () => {
  it('names the provider order and the model without its publisher prefix', () => {
    expect(aiAnalystLabel({ mode: 'ai', model: 'm', chain: [{ provider: 'groq', label: 'Groq', model: 'g' }, { provider: 'nvidia', label: 'NVIDIA', model: 'n' }] })).toBe('Groq → NVIDIA')
    expect(providerModel('nvidia', 'openai/gpt-oss-20b')).toBe('NVIDIA · gpt-oss-20b')
    expect(aiAnalystLabel(undefined)).toBe('AI')
  })
})

describe('activityFromEvents', () => {
  it('describes only streamed events, grouping calculations per phase', () => {
    const events: AgentEvent[] = [
      { type: 'start', mode: 'ai', model: 'm', phases: [] },
      { type: 'tool', phase: 1, name: 'dataset_overview', evidence_id: 'E1' },
      { type: 'tool', phase: 1, name: 'describe_column', count: 3 },
      { type: 'phase', phase: 0, name: 'Business understanding', status: 'passed_with_assumptions', checks: [{ check: 'a', passed: true, detail: '' }] },
      { type: 'log', phase: 0, message: 'Groq could not continue (limit). Switching to NVIDIA (n).' },
      { type: 'tool', phase: 4, name: 'trend', evidence_id: 'E12' },
      { type: 'tool', phase: 4, name: 'kpi', error: 'Rating is a number column' },
      { type: 'tool', phase: 4, name: 'segment_contribution', evidence_id: 'E13' },
      { type: 'phase', phase: 5, name: 'Validation and insights', status: 'blocked', checks: [{ check: 'Every number is grounded', passed: false, detail: '1 of 2 grounded' }] },
    ]
    expect(activityFromEvents(events)).toEqual([
      { tone: 'calc', phase: 1, text: 'Ran 4 calculations: dataset overview, describe column', detail: 'Evidence E1' },
      { tone: 'info', phase: 0, text: 'Phase 0 passed with assumptions: Business understanding', detail: 'Assumptions are recorded in the charter; confirm them in Plan & method.' },
      { tone: 'warn', phase: 0, text: 'Groq could not continue (limit). Switching to NVIDIA (n).' },
      { tone: 'calc', phase: 4, text: 'Ran 2 calculations: trend, segment contribution', detail: 'Evidence E12–E13' },
      { tone: 'neutral', phase: 4, text: 'A calculation was refused by input checks and retried', detail: 'Rating is a number column' },
      { tone: 'bad', phase: 5, text: 'Phase 5 did not pass: Validation and insights', detail: 'Every number is grounded: 1 of 2 grounded' },
    ])
  })
})

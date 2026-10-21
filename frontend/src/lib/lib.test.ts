import { describe, expect, it, vi } from 'vitest'
import { profile } from '../test/fixtures'
import { api, ApiError } from './api'
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

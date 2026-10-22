import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { config, jsonResponse, profile, result } from './test/fixtures'
import agentEvents from './test/agentEvents.json'

// agentEvents.json was produced by the real backend workflow on the hand-checked fixture (tests/conftest.py).
const ndjson = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n') + '\n'

function mockServer(agentBody: string = ndjson(agentEvents)) {
  const calls: { url: string; body?: FormData }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '')
    calls.push({ url: path, body: init?.body as FormData | undefined })
    if (path === '/api/config') return jsonResponse(config)
    if (path === '/api/samples') return jsonResponse([{ id: 'retail-sales', file_name: 'retail_sales.csv', title: 'Retail sales (CSV)', description: 'Synthetic.' }])
    if (path === '/api/samples/retail-sales') return new Response('a,b\n1,2\n', { status: 200 })
    if (path === '/api/profile') return jsonResponse(profile)
    if (path === '/api/analyze') return jsonResponse(result)
    if (path === '/api/report/export') return new Response(new Blob(['PK']), { status: 200, headers: { 'Content-Disposition': 'attachment; filename="tabulavibe_analysis.pptx"' } })
    if (path === '/api/agent/run') return new Response(agentBody, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
    return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
  })
  return calls
}

async function openAnalyst(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'Load sample: Retail sales (CSV)' }))
  await user.click(await screen.findByRole('button', { name: 'AI Analyst' }))
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:handover')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

describe('AI analyst', () => {
  it('collects business context, streams the phases and renders the validated report', async () => {
    const user = userEvent.setup()
    const calls = mockServer()
    await openAnalyst(user)

    expect(screen.getByText('Rules-based (AI not configured)')).toBeInTheDocument()
    await user.type(screen.getByLabelText('What does this data describe?'), 'Small shop sales')
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))

    expect(await screen.findByRole('heading', { name: 'Analysis of sales.csv' })).toBeInTheDocument()
    const sent = calls.find((c) => c.url === '/api/agent/run')!
    expect(JSON.parse(sent.body!.get('context') as string)).toMatchObject({ domain: 'Small shop sales' })
    expect(sent.body!.get('file')).toBeInstanceOf(File)

    // Every phase passed its gate (statuses come from the server).
    const timeline = screen.getByRole('list', { name: 'Workflow phases' })
    expect(within(timeline).getByLabelText('Phase 5: Validation and insights, Passed')).toBeInTheDocument()
    expect(within(timeline).getByLabelText('Phase 0: Business understanding, Passed (assumptions)')).toBeInTheDocument()

    // Overview: KPI reconciled with an independent recalculation (hand-checked total 355).
    expect(screen.getByText('Total revenue')).toBeInTheDocument()
    expect(screen.getAllByText('355').length).toBeGreaterThan(0)
  })

  it('shows insight cards answering the seven questions, filterable by kind', async () => {
    const user = userEvent.setup()
    mockServer()
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    await screen.findByRole('heading', { name: 'Analysis of sales.csv' })

    await user.click(screen.getByRole('tab', { name: 'Insights' }))
    const card = screen.getByRole('article', { name: 'Insight F1' })
    expect(within(card).getByText("'B' (product) contributes 56.3% of revenue")).toBeInTheDocument()
    for (const q of ['What happened?', 'Where?', 'How large?', 'What might explain it? (not verified)', 'What action to consider?', 'How to measure success?']) {
      expect(within(card).getByText(q)).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: /^Data quality \(/ }))
    expect(screen.getByText('Duplicate rows change total revenue by 24.56%')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Insight F1' })).not.toBeInTheDocument()
  })

  it('drills down from an insight into the Analyse step with the same metric engine', async () => {
    const user = userEvent.setup()
    const calls = mockServer()
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    await screen.findByRole('heading', { name: 'Analysis of sales.csv' })
    await user.click(screen.getByRole('tab', { name: 'Insights' }))
    await user.click(within(screen.getByRole('article', { name: 'Insight F1' })).getByRole('button', { name: 'Explore in Analyse' }))

    expect(await screen.findByRole('tab', { name: '3. Analyse', selected: true })).toBeInTheDocument()
    const analyze = calls.filter((c) => c.url === '/api/analyze').at(-1)!
    expect(JSON.parse(analyze.body!.get('spec') as string)).toMatchObject({ group_by: 'product', measures: [{ column: 'revenue', aggregation: 'sum' }], filters: [] })
  })

  it('offers the univariate selector, plan registers and the handover download', async () => {
    const user = userEvent.setup()
    mockServer()
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    await screen.findByRole('heading', { name: 'Analysis of sales.csv' })

    await user.click(screen.getByRole('tab', { name: 'Univariate' }))
    await user.selectOptions(screen.getByLabelText('Variable'), 'units')
    expect(screen.getByText('Excess kurtosis')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Box plot of units: median 5/ })).toBeInTheDocument() // hand-checked median

    await user.click(screen.getByRole('tab', { name: 'Plan & method' }))
    expect(screen.getByRole('table', { name: 'Question register' })).toBeInTheDocument()
    expect(screen.getByText('Small shop sales (test fixture)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Download handover (.md)' }))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('downloads the AI analyst report as PowerPoint and PDF', async () => {
    const user = userEvent.setup()
    const calls = mockServer()
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    await screen.findByRole('heading', { name: 'Analysis of sales.csv' })
    await user.click(screen.getByRole('button', { name: 'Download PowerPoint' }))
    await user.click(screen.getByRole('button', { name: 'Download PDF' }))
    const bodies = calls.filter((c) => c.url === '/api/report/export').map((c) => JSON.parse(c.body as unknown as string))
    expect(bodies.map((b) => [b.format, b.kind])).toEqual([['pptx', 'agent'], ['pdf', 'agent']])
    expect(bodies[0].data.findings.length).toBeGreaterThan(0)
  })

  it('shows the provider switch, the evaluation scorecard and the Kumo forecast', async () => {
    const user = userEvent.setup()
    const events = structuredClone(agentEvents) as { type: string; report?: Record<string, unknown> }[]
    const final = events.at(-1)!.report!
    const criteria = (detail: string, score: number) => ({
      mode: score === 100 ? 'ai' : 'rules',
      provider: score === 100 ? 'nvidia' : null,
      model: score === 100 ? 'meta/llama-3.3-70b-instruct' : null,
      score,
      criteria: [{ key: 'grounded', label: 'Findings whose numbers match their evidence', weight: 30, value: 1, detail }],
    })
    Object.assign(final, {
      mode: 'ai',
      provider: 'nvidia',
      model: 'meta/llama-3.3-70b-instruct',
      ai_note: null,
      provider_switches: ["Groq stopped (the request is larger than Groq's free-plan limit); NVIDIA continued"],
      evaluation: { winner: 'ai', rule: 'The analysis with the higher score builds the dashboard; a tie goes to the AI analyst.', candidates: [criteria('2 of 2', 100), criteria('1 of 2', 85)] },
      forecast: {
        status: 'ok', provider: 'nvidia', model: 'kumo-relational', date_column: 'date', measure: 'revenue', aggregation: 'sum', grain: 'month',
        shared: '10 monthly sum values of revenue (period totals only, never raw rows)',
        history: [{ period: '2025-10', start: '2025-10-01', value: 100 }],
        forecast: [{ step: 1, period: '2025-11', start: '2025-11-01', value: 110 }],
        backtest: { periods: [{ period: '2025-10', actual: 100, kumo: 100, naive: 90 }], kumo_mae: 0, naive_mae: 10, kumo_better: true },
        notes: ['A forecast is an estimate from past patterns, not a guarantee; it does not know about future events.'],
      },
    })
    mockServer(ndjson(events))
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    await screen.findByRole('heading', { name: 'Analysis of sales.csv' })

    expect(screen.getByText(/Groq stopped/)).toBeInTheDocument()
    expect(screen.getByText(/AI analyst \(NVIDIA · llama-3.3-70b-instruct\)/)).toBeInTheDocument()
    const forecast = screen.getByRole('table', { name: 'Forecast values' })
    expect(within(forecast).getByText('2025-11')).toBeInTheDocument()
    expect(within(forecast).getByText('110')).toBeInTheDocument()
    expect(screen.getByText('Kumo was more accurate')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Plan & method' }))
    const scorecard = screen.getByRole('table', { name: 'Analysis evaluation' })
    expect(within(scorecard).getByText('2 of 2')).toBeInTheDocument()
    expect(within(scorecard).getByText(/AI \(NVIDIA\)/)).toBeInTheDocument()
    expect(within(scorecard).getByText('85')).toBeInTheDocument()
  })

  it('shows a clear error when the stream reports a failure', async () => {
    const user = userEvent.setup()
    mockServer(ndjson([{ type: 'start', mode: 'rules', model: null, phases: [] }, { type: 'error', error: { code: 'agent_failed', message: 'The analysis stopped unexpectedly. Please try again.' } }]))
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    expect(await screen.findByText('The analysis stopped unexpectedly. Please try again.')).toBeInTheDocument()
  })
})

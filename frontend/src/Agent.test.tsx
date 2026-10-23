import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { config, jsonResponse, profile, result } from './test/fixtures'
import agentEvents from './test/agentEvents.json'

// agentEvents.json was produced by the real backend workflow on the hand-checked fixture (tests/conftest.py).
const ndjson = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n') + '\n'

function mockServer(agentBody: string = ndjson(agentEvents), cfg: unknown = config, chat: unknown[] = []) {
  const calls: { url: string; body?: FormData }[] = []
  const answers = [...chat]
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '')
    calls.push({ url: path, body: init?.body as FormData | undefined })
    if (path === '/api/config') return jsonResponse(cfg)
    if (path === '/api/agent/chat') return jsonResponse(answers.shift())
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
      model: score === 100 ? 'openai/gpt-oss-20b' : null,
      score,
      criteria: [{ key: 'grounded', label: 'Findings whose numbers match their evidence', weight: 30, value: 1, detail }],
    })
    Object.assign(final, {
      mode: 'ai',
      provider: 'nvidia',
      model: 'openai/gpt-oss-20b',
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
    expect(screen.getByText(/AI analyst \(NVIDIA · gpt-oss-20b\)/)).toBeInTheDocument()
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

  it('puts Ask AI first and explains when AI is not switched on', async () => {
    const user = userEvent.setup()
    mockServer()
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    await screen.findByRole('heading', { name: 'Analysis of sales.csv' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)[0]).toBe('Ask AI')
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Ask AI' }))
    expect(screen.getByText('Ask AI is not switched on')).toBeInTheDocument()
    expect(screen.getByLabelText('Your question')).toBeDisabled()
  })

  it('answers questions with text, a chart and checked numbers, and keeps the conversation', async () => {
    const user = userEvent.setup()
    const aiConfig = { ...config, ai: { enabled: true, provider: 'groq', model: 'g' }, agent: { mode: 'ai', provider: 'groq', model: 'g', chain: [], forecast: null } }
    const first = {
      answer: 'South brings in the most revenue: 190 of 355.\n- It is the largest region.\n- **Check** whether this holds every month.',
      evidence_ids: ['E7', 'C1'],
      charts: [{ evidence_id: 'C1', kind: 'bar', title: 'Revenue by region', measure: 'Total revenue', rows: [{ label: 'South', value: 190 }, { label: 'East', value: 165 }] }],
      grounded: true,
      unverified_numbers: [],
      follow_up_questions: ['How did South change over time?'],
      provider: 'nvidia',
      model: 'openai/gpt-oss-20b',
      provider_switches: ["Groq stopped (the request is larger than Groq's free-plan limit); NVIDIA continued"],
      new_evidence: [{ id: 'C1', tool: 'segment_contribution', args: { measure: 'revenue', dimension: 'region' } }],
    }
    const second = { ...first, answer: 'It rose and then fell.', evidence_ids: [], charts: [], grounded: false, unverified_numbers: ['42'], follow_up_questions: [], provider_switches: [], new_evidence: [] }
    const calls = mockServer(ndjson(agentEvents), aiConfig, [first, second])
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    await screen.findByRole('heading', { name: 'Analysis of sales.csv' })
    await user.click(screen.getByRole('tab', { name: 'Ask AI' }))

    await user.click(screen.getByRole('button', { name: 'What are the three most important things in this data?' }))
    const answer = await screen.findByRole('article', { name: 'AI answer' })
    expect(within(answer).getByText('South brings in the most revenue: 190 of 355.')).toBeInTheDocument()
    expect(within(answer).getByText('It is the largest region.')).toBeInTheDocument()
    expect(within(answer).getByText('Check').tagName).toBe('STRONG')
    expect(within(answer).getByText('Revenue by region')).toBeInTheDocument()
    expect(within(answer).getByRole('img', { name: /Bar chart/i })).toBeInTheDocument()
    expect(within(answer).getByText('Numbers checked')).toBeInTheDocument()
    expect(within(answer).getByText(/NVIDIA · gpt-oss-20b/)).toBeInTheDocument()

    const sent = JSON.parse(calls.find((c) => c.url === '/api/agent/chat')!.body!.get('payload') as string)
    expect(sent.question).toBe('What are the three most important things in this data?')
    expect(sent.history).toEqual([])
    expect(sent.report.evidence.every((e: Record<string, unknown>) => !('result' in e))).toBe(true) // the server recomputes evidence

    // The conversation survives switching tabs; a follow-up sends the history and earlier calculations.
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    await user.click(screen.getByRole('tab', { name: 'Ask AI' }))
    await user.type(screen.getByLabelText('Your question'), 'And over time?{Enter}')
    expect(await screen.findByText('It rose and then fell.')).toBeInTheDocument()
    expect(screen.getByText('Unverified: 42')).toBeInTheDocument()
    const followUp = JSON.parse(calls.filter((c) => c.url === '/api/agent/chat')[1].body!.get('payload') as string)
    expect(followUp.history.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
    expect(followUp.chat_evidence).toEqual(first.new_evidence)
  })

  it('shows the live timeline from streamed events: current phase, checks, assumptions and a blocked phase', async () => {
    const user = userEvent.setup()
    const lines = ndjson([
      { type: 'start', mode: 'rules', model: null, phases: [] },
      { type: 'tool', phase: 1, name: 'dataset_overview', evidence_id: 'E1' },
      { type: 'phase', phase: 0, name: 'Business understanding', status: 'passed_with_assumptions', checks: [{ check: 'Business context documented', passed: true, detail: '' }] },
      { type: 'phase', phase: 1, name: 'Data understanding', status: 'passed', checks: [{ check: 'Rows and columns profiled', passed: true, detail: '' }] },
      { type: 'phase', phase: 2, name: 'Business problem discovery', status: 'blocked', checks: [{ check: 'Questions registered', passed: false, detail: 'no questions' }] },
      { type: 'tool', phase: 4, name: 'trend', evidence_id: 'E12' },
    ])
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    mockServer()
    const fetchMock = vi.mocked(globalThis.fetch)
    const fallback = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/api/agent/run')) {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
            c.enqueue(new TextEncoder().encode(lines))
          },
        })
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
      }
      return fallback(input, init)
    })
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))

    expect(await screen.findByText('Phase 4 · Exploratory analysis')).toBeInTheDocument()
    expect(screen.getByText('3 of 9 phases complete')).toBeInTheDocument()
    expect(screen.getByLabelText('Phase 0: Business understanding, Passed (assumptions)')).toBeInTheDocument()
    expect(screen.getByText('A phase did not pass its exit checks')).toBeInTheDocument()
    const activity = screen.getByRole('list', { name: 'Analyst activity' })
    expect(within(activity).getByText('Phase 2 did not pass: Business problem discovery')).toBeInTheDocument()
    expect(within(activity).getByText('Questions registered: no questions')).toBeInTheDocument()
    expect(within(activity).getByText('Ran 1 calculation: trend')).toBeInTheDocument()
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument() // no invented percentage progress
    controller?.close()
  })

  it('leads the report with prioritised findings, their evidence and next steps', async () => {
    const user = userEvent.setup()
    mockServer()
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    expect(await screen.findByRole('heading', { name: 'What the analysis found' })).toBeInTheDocument()
    const briefs = screen.getAllByRole('article', { name: /^Key finding/ })
    expect(briefs.map((b) => b.getAttribute('aria-label'))).toEqual(['Key finding F1', 'Key finding F2', 'Key finding F3']) // the top three first
    await user.click(screen.getByRole('button', { name: 'Show 2 more findings' }))
    expect(screen.getAllByRole('article', { name: /^Key finding/ })).toHaveLength(5)
    for (const label of ['What happened', 'Why it may matter', 'Evidence', 'What to investigate next']) expect(within(briefs[0]).getByText(label)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Supporting KPIs' })).toBeInTheDocument()
    expect(screen.getByText('Next steps and limitations')).toBeInTheDocument()
    expect(within(briefs[0]).queryByRole('button', { name: 'Ask AI about this' })).not.toBeInTheDocument() // AI is off
  })

  it('opens Ask AI with a question about a finding', async () => {
    const user = userEvent.setup()
    const aiConfig = { ...config, ai: { enabled: true, provider: 'groq', model: 'g' }, agent: { mode: 'ai', provider: 'groq', model: 'g', chain: [], forecast: null } }
    const answer = { answer: 'B leads.', evidence_ids: [], charts: [], grounded: true, unverified_numbers: [], follow_up_questions: [], provider: 'groq', model: 'g', provider_switches: [], new_evidence: [] }
    const calls = mockServer(ndjson(agentEvents), aiConfig, [answer])
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    const first = (await screen.findAllByRole('article', { name: /^Key finding/ }))[0]
    await user.click(within(first).getByRole('button', { name: 'Ask AI about this' }))
    expect(await screen.findByText('B leads.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ask AI', selected: true })).toBeInTheDocument()
    const sent = JSON.parse(calls.find((c) => c.url === '/api/agent/chat')!.body!.get('payload') as string)
    expect(sent.question.startsWith('Explain finding F1: ')).toBe(true)
  })

  it('shows a clear error when the stream reports a failure', async () => {
    const user = userEvent.setup()
    mockServer(ndjson([{ type: 'start', mode: 'rules', model: null, phases: [] }, { type: 'error', error: { code: 'agent_failed', message: 'The analysis stopped unexpectedly. Please try again.' } }]))
    await openAnalyst(user)
    await user.click(screen.getByRole('button', { name: 'Run the AI analyst' }))
    expect(await screen.findByText('The analysis stopped unexpectedly. Please try again.')).toBeInTheDocument()
  })
})

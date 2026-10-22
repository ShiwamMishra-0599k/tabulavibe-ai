import { api, ApiError, streamRequest } from './api'
import type { AnalysisSpec, ResultRow } from './types'
import type { AppConfig } from './types'

/**
 * The AI analyst (phases 0-8). The backend streams NDJSON progress events and finishes with the
 * report. Every number in the report was computed by Python; the frontend only formats it.
 */

export type PhaseStatus = 'pending' | 'running' | 'passed' | 'passed_with_assumptions' | 'blocked' | 'skipped'

export interface PhaseCheck {
  check: string
  passed: boolean
  detail: string
}

export interface Phase {
  id: number
  name: string
  exit_criteria?: string
  status: PhaseStatus
  checks: PhaseCheck[]
}

export interface BusinessContext {
  domain: string
  audience: string
  objective: string
  kpis: string
  notes: string
}

export const EMPTY_CONTEXT: BusinessContext = { domain: '', audience: '', objective: '', kpis: '', notes: '' }

export interface Evidence<R = Record<string, unknown>> {
  id: string
  tool: string
  args: Record<string, unknown>
  phase: number
  result: R
}

export interface Finding {
  id: string
  title: string
  what_happened: string
  where: string
  magnitude: string
  baseline: string
  comparison: string
  evidence_ids: string[]
  possible_explanations: string[]
  recommended_action: string
  success_metric: string
  confidence: 'high' | 'medium' | 'low'
  limitations: string
  kind: 'observed_fact' | 'statistical_association' | 'data_quality'
  grounded: boolean
  unverified_numbers: string[]
  spec: AnalysisSpec | null
}

export interface Question {
  id: string
  question: string
  rationale: string
  variables: string[]
  metrics: string[]
  method: string
  priority: 'high' | 'medium' | 'low'
  limitations: string
  evidence_ids: string[]
  status: string
}

export interface Hypothesis {
  id: string
  question_id: string
  statement: string
  test: string | null
  result: 'supported' | 'not_supported' | 'inconclusive'
  evidence_ids: string[]
  p_value?: number | null
  adjusted_p_value?: number | null
}

export interface EvaluationCandidate {
  mode: 'ai' | 'rules'
  provider: string | null
  model: string | null
  /** 0-100: weighted sum of the criteria (weights sum to 100). */
  score: number
  criteria: { key: string; label: string; weight: number; value: number; detail: string }[]
}

export interface ForecastPoint {
  period: string
  start: string
  value: number | null
  step?: number
}

/** Predictive forecast of the primary measure by NVIDIA Kumo Relational (history computed by Python). */
export interface Forecast {
  status: 'ok' | 'skipped' | 'failed'
  provider: string
  model: string
  note?: string
  date_column?: string
  measure?: string
  aggregation?: string
  grain?: string
  shared?: string
  history?: ForecastPoint[]
  forecast?: ForecastPoint[]
  backtest?: { periods: { period: string; actual: number; kumo: number; naive: number }[]; kumo_mae: number; naive_mae: number; kumo_better: boolean } | null
  notes?: string[]
}

export interface AgentReport {
  version: number
  app_version: string
  mode: 'ai' | 'rules'
  /** The AI provider that finished the run (groq or nvidia). */
  provider?: string | null
  model: string | null
  /** Why an earlier provider handed the conversation to the next one. */
  provider_switches?: string[]
  /** The AI run scored against the rules-based baseline; the winner builds the dashboard. */
  evaluation?: { winner: 'ai' | 'rules'; rule: string; candidates: EvaluationCandidate[] }
  forecast?: Forecast
  primary_measure?: string | null
  ai_note: string | null
  generated_at: string
  duration_seconds: number
  dataset: { file_name: string; file_type: string; rows: number; columns: number }
  phases: Phase[]
  charter: {
    business_context: string
    stakeholders: string
    objectives: string[]
    decisions_supported: string[]
    in_scope: string[]
    out_of_scope: string[]
    success_criteria: string[]
    preliminary_kpis: string[]
    assumptions: string[]
    provided_by_user: boolean
  }
  data_understanding: {
    overview_evidence: string
    grain: string
    grain_basis: string
    data_dictionary: { column: string; type: string; role: string; meaning: string; missing_pct: number | null; unique: number; evidence_id: string | null; notes: string[] }[]
    quality_issues: { severity: 'warning' | 'info'; issue: string; detail: string; kind: 'data_quality' | 'needs_investigation' }[]
    limitations: string[]
    source_inventory: { source: string; type: string; sheet: string | null; rows: number; columns: number; lineage: string }[]
  }
  questions: Question[]
  hypotheses: Hypothesis[]
  preparation: {
    raw_data_preserved: boolean
    cleaning_log: { step: string; decision: string; reason: string; applied: boolean }[]
    derived_fields: { field: string; formula: string; use: string }[]
    metric_definitions: { name: string; formula: string; column: string | null; aggregation: string }[]
    primary_measure: string | null
  }
  validation: {
    multiple_testing: { method: string; alpha: number; tests: { evidence_id: string; p_value: number; adjusted_p_value: number; significant: boolean }[] }
    reconciliation: { evidence_id: string; measure: string; aggregation: string; engine_value: number | null; independent_value: number | null; reconciled: boolean; value_without_duplicates: number | null; duplicate_effect_pct: number | null }[]
    all_reconciled: boolean | null
  }
  findings: Finding[]
  dashboard: {
    kpis: { label: string; value: number | null; unit: string | null; definition: string; evidence_id: string }[]
    charts: { type: string; evidence_id: string; tool: string; args: Record<string, unknown> }[]
    key_findings: string[]
    unverified_findings: string[]
  }
  outstanding_questions: string[]
  limitations: string[]
  evidence: Evidence[]
  handover_markdown: string
}

export type AgentEvent =
  | { type: 'start'; mode: 'ai' | 'rules'; model: string | null; phases: { id: number; name: string }[] }
  | { type: 'phase'; phase: number; name: string; status: PhaseStatus; checks: PhaseCheck[] }
  | { type: 'tool'; phase: number; name: string; evidence_id?: string; error?: string; question_id?: string; count?: number }
  | { type: 'log'; phase: number; message: string }
  | { type: 'report'; report: AgentReport }
  | { type: 'error'; error: { code: string; message: string } }

/** Runs the analyst and calls onEvent for each streamed event. Resolves with the final report. */
export async function runAgent(file: File, context: BusinessContext, onEvent: (event: AgentEvent) => void): Promise<AgentReport> {
  const body = new FormData()
  body.append('file', file, file.name)
  body.append('context', JSON.stringify(context))
  let report: AgentReport | null = null
  await streamRequest('/api/agent/run', { method: 'POST', body }, (line) => {
    const event = JSON.parse(line) as AgentEvent
    if (event.type === 'error') throw new ApiError(event.error.code, event.error.message, 500)
    if (event.type === 'report') report = event.report
    onEvent(event)
  })
  if (!report) throw new ApiError('agent_incomplete', 'The analysis ended before the report was ready. Please try again.', 0)
  return report
}

export function evidenceById(report: AgentReport): Map<string, Evidence> {
  return new Map(report.evidence.map((e) => [e.id, e]))
}

/** Adapts evidence to the shared chart components (which take ResultRow[] with a value key). */
export function rowsOf(labels: { group: string; rows: number; value: number | null }[]): ResultRow[] {
  return labels.map((l) => ({ group: l.group, row_count: l.rows, values: { v: l.value } }))
}

export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  passed: 'Passed',
  passed_with_assumptions: 'Passed (assumptions)',
  blocked: 'Blocked',
  skipped: 'Skipped',
}

export const KIND_LABEL: Record<Finding['kind'], string> = {
  observed_fact: 'Observed fact',
  statistical_association: 'Statistical association',
  data_quality: 'Data quality',
}

export function formatP(p: number | null | undefined): string {
  if (p === null || p === undefined) return 'n/a'
  return p < 0.0001 ? '< 0.0001' : p.toFixed(4)
}

export const PHASE_NAMES = [
  'Business understanding',
  'Data understanding',
  'Business problem discovery',
  'Data preparation',
  'Exploratory analysis',
  'Validation and insights',
  'Dashboard',
  'Quality checks',
  'Handover',
]

/** Phase statuses from the streamed events (the report's phases once it has arrived). */
export function phasesFromEvents(events: AgentEvent[], running: boolean): Phase[] {
  const phases: Phase[] = PHASE_NAMES.map((name, id) => ({ id, name, status: 'pending', checks: [] }))
  for (const e of events) {
    if (e.type === 'phase') phases[e.phase] = { ...phases[e.phase], status: e.status, checks: e.checks }
    if (e.type === 'tool' && phases[e.phase]?.status === 'pending') phases[e.phase] = { ...phases[e.phase], status: 'running' }
  }
  if (running) {
    const next = phases.find((p) => p.status === 'pending')
    if (next && !phases.some((p) => p.status === 'running')) next.status = 'running'
  }
  return phases
}

export const PROVIDER_LABEL: Record<string, string> = { groq: 'Groq', nvidia: 'NVIDIA' }

/** Badge text for the AI analyst: the providers in the order they are tried, e.g. "Groq → NVIDIA". */
export function aiAnalystLabel(agent: AppConfig['agent']): string {
  const chain = agent?.chain ?? []
  if (chain.length) return chain.map((c) => c.label).join(' → ')
  return agent?.provider ? (PROVIDER_LABEL[agent.provider] ?? agent.provider) : 'AI'
}

/** "Groq · gpt-oss-120b" (the publisher prefix of the model id is dropped). */
export function providerModel(provider: string | null | undefined, model: string | null | undefined): string {
  const name = (model ?? '').split('/').pop()
  const label = provider ? (PROVIDER_LABEL[provider] ?? provider) : 'AI'
  return name ? `${label} · ${name}` : label
}

// ---------------------------------------------------------------- Ask AI

export interface ChatChart {
  evidence_id: string
  kind: 'bar' | 'line' | 'pie'
  title: string
  measure: string
  rows: { label: string; value: number }[]
}

export interface ChatAnswer {
  answer: string
  evidence_ids: string[]
  charts: ChatChart[]
  /** Every number in the answer matched the evidence it cites. */
  grounded: boolean
  unverified_numbers: string[]
  follow_up_questions: string[]
  provider: string
  model: string
  provider_switches: string[]
  new_evidence: { id: string; tool: string; args: Record<string, unknown> }[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  answer?: ChatAnswer
}

/** Asks one question. The report goes without evidence results: the server recomputes what it reads. */
export async function askAgent(file: File, report: AgentReport, question: string, history: ChatMessage[], chatEvidence: ChatAnswer['new_evidence']): Promise<ChatAnswer> {
  const slim = { ...report, handover_markdown: '', evidence: report.evidence.map(({ id, tool, args, phase }) => ({ id, tool, args, phase })) }
  const payload = {
    question,
    history: history.slice(-12).map((m) => ({ role: m.role, text: m.text.slice(0, 6000) })),
    report: slim,
    chat_evidence: chatEvidence.slice(-60),
  }
  return (await api.agentChat(file, payload)) as ChatAnswer
}

/** Starter questions that this report can answer. */
export function suggestedQuestions(report: AgentReport): string[] {
  const out = ['What are the three most important things in this data?']
  const measure = report.primary_measure ?? report.preparation.primary_measure
  const dims = report.data_understanding.data_dictionary.filter((c) => c.role === 'dimension').map((c) => c.column)
  const dates = report.data_understanding.data_dictionary.filter((c) => c.type === 'date').map((c) => c.column)
  if (measure && dims[0]) out.push(`Which ${dims[0]} brings in the most ${measure}?`)
  if (measure && dates[0]) out.push(`How has ${measure} changed over time?`)
  if (report.forecast?.status === 'ok') out.push(`What is the forecast for ${report.forecast.measure}, and how reliable is it?`)
  out.push('Which data-quality problems should I fix first?')
  return out.slice(0, 5)
}

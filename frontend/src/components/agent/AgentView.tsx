import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Clock,
  Download,
  FileText,
  Info,
  LoaderCircle,
  MessagesSquare,
  Presentation,
  RotateCcw,
  ShieldCheck,
  Sigma,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import {
  activityFromEvents,
  aiAnalystLabel,
  evidenceById,
  providerModel,
  PHASE_STATUS_LABEL,
  phasesFromEvents,
  type ActivityItem,
  type AgentEvent,
  type AgentReport,
  type BusinessContext,
  type Phase,
  type PhaseStatus,
} from '../../lib/agent'
import type { AnalysisSpec, AppConfig } from '../../lib/types'
import { saveBlob, type ReportFormat } from '../../lib/api'
import { formatNumber } from '../../lib/format'
import { Alert, Badge, Button, Card, IconChip, TabBar, inputClass, labelClass } from '../ui'
import { AskAI } from './AskAI'
import { BivariatePage, InsightsPage, MultivariatePage, OverviewPage, PlanPage, QualityPage, UnivariatePage, type PageProps } from './AgentPages'

const STATUS_ICON: Record<PhaseStatus, { icon: LucideIcon; className: string }> = {
  pending: { icon: CircleDashed, className: 'text-ink-muted' },
  running: { icon: LoaderCircle, className: 'animate-spin text-accent' },
  passed: { icon: CircleCheck, className: 'text-good' },
  passed_with_assumptions: { icon: CircleCheck, className: 'text-accent' },
  blocked: { icon: CircleX, className: 'text-bad' },
  skipped: { icon: CircleSlash, className: 'text-ink-muted' },
}

const DONE: PhaseStatus[] = ['passed', 'passed_with_assumptions', 'blocked', 'skipped']

/** Compact strip of the nine phases (used on the finished report). */
export function PhaseTimeline({ phases }: { phases: Phase[] }) {
  return (
    <ol aria-label="Workflow phases" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9">
      {phases.map((p) => {
        const { icon: Icon, className } = STATUS_ICON[p.status]
        const failed = p.checks.filter((c) => !c.passed)
        return (
          <li
            key={p.id}
            aria-label={`Phase ${p.id}: ${p.name}, ${PHASE_STATUS_LABEL[p.status]}`}
            title={p.checks.map((c) => `${c.passed ? '✓' : '✗'} ${c.check}${c.detail ? `: ${c.detail}` : ''}`).join('\n') || PHASE_STATUS_LABEL[p.status]}
            className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs ${p.status === 'blocked' ? 'border-bad/40 bg-bad-soft' : 'border-line bg-surface'}`}
          >
            <Icon aria-hidden className={`mt-px size-4 shrink-0 ${className}`} />
            <span className="min-w-0">
              <span className="block font-semibold text-ink">
                {p.id}. {p.name}
              </span>
              <span className="block text-ink-muted">{PHASE_STATUS_LABEL[p.status]}</span>
              {failed.map((c) => (
                <span key={c.check} className="mt-0.5 block text-bad">
                  {c.check}
                </span>
              ))}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** Vertical phase list with exit checks, shown while the analyst runs. */
function PhaseSteps({ phases, calculations }: { phases: Phase[]; calculations: Map<number, number> }) {
  return (
    <ol aria-label="Workflow phases" className="grid">
      {phases.map((p, i) => {
        const { icon: Icon, className } = STATUS_ICON[p.status]
        const passed = p.checks.filter((c) => c.passed).length
        const failed = p.checks.filter((c) => !c.passed)
        const n = calculations.get(p.id) ?? 0
        const last = i === phases.length - 1
        return (
          <li key={p.id} aria-label={`Phase ${p.id}: ${p.name}, ${PHASE_STATUS_LABEL[p.status]}`} className="relative flex gap-3 pb-3">
            {!last && <span aria-hidden className={`absolute left-[9px] top-6 bottom-0 w-px ${DONE.includes(p.status) ? 'bg-good/40' : 'bg-line'}`} />}
            <Icon aria-hidden className={`relative mt-0.5 size-[19px] shrink-0 rounded-full bg-surface ${className}`} />
            <div className={`min-w-0 flex-1 ${p.status === 'running' ? 'rounded-xl bg-accent-soft/60 px-2.5 py-1.5 ring-1 ring-accent/20' : ''}`}>
              <p className={`text-sm ${p.status === 'pending' ? 'text-ink-muted' : 'font-semibold text-ink'}`}>
                {p.id}. {p.name}
              </p>
              <p className="text-xs text-ink-muted">
                {p.status === 'running'
                  ? `In progress${n ? ` · ${n} calculation${n === 1 ? '' : 's'} so far` : ''}`
                  : p.status === 'pending'
                    ? 'Waiting'
                    : `${PHASE_STATUS_LABEL[p.status]}${p.checks.length ? ` · ${passed} of ${p.checks.length} checks` : ''}${n ? ` · ${n} calculation${n === 1 ? '' : 's'}` : ''}`}
              </p>
              {failed.map((c) => (
                <p key={c.check} className="mt-0.5 text-xs text-bad">
                  ✗ {c.check}
                  {c.detail ? `: ${c.detail}` : ''}
                </p>
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const TONE: Record<ActivityItem['tone'], { icon: LucideIcon; className: string }> = {
  good: { icon: CircleCheck, className: 'text-good' },
  info: { icon: Info, className: 'text-accent-text' },
  warn: { icon: TriangleAlert, className: 'text-warn' },
  bad: { icon: CircleX, className: 'text-bad' },
  neutral: { icon: CircleDashed, className: 'text-ink-muted' },
  calc: { icon: Sigma, className: 'text-accent-text' },
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const recent = items.slice(-14).reverse()
  return (
    <ol aria-label="Analyst activity" aria-live="polite" className="grid gap-2">
      {recent.length === 0 && <li className="text-sm text-ink-muted">Reading and profiling the file…</li>}
      {recent.map((item, i) => {
        const { icon: Icon, className } = TONE[item.tone]
        return (
          <li key={`${items.length - i}`} className={`flex gap-2.5 rounded-xl px-2.5 py-2 text-sm ${i === 0 ? 'bg-surface-2' : ''}`}>
            <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${className}`} />
            <div className="min-w-0">
              <p className="text-ink">
                {item.phase !== null && <span className="tabular mr-1.5 text-xs font-semibold text-ink-muted">P{item.phase}</span>}
                {item.text}
              </p>
              {item.detail && <p className="mt-0.5 break-words text-xs text-ink-muted">{item.detail}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function elapsedText(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

/** Real elapsed seconds since `running` became true (nothing estimated); resets when a run ends. */
function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running) return
    const start = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000)
    return () => {
      window.clearInterval(timer)
      setElapsed(0)
    }
  }, [running])
  return elapsed
}

const FIELDS: { key: keyof BusinessContext; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: 'domain', label: 'What does this data describe?', placeholder: 'e.g. Online orders of a home-goods shop, Jan–Dec 2025' },
  { key: 'audience', label: 'Who will use the dashboard?', placeholder: 'e.g. The owner and the store manager' },
  { key: 'objective', label: 'What decision should it help with?', placeholder: 'e.g. Which regions and categories to focus on next quarter' },
  { key: 'kpis', label: 'KPIs that matter most', placeholder: 'e.g. revenue, units' },
  { key: 'notes', label: 'Anything else the analyst should know?', placeholder: 'e.g. December is our peak season; refunds are negative amounts', multiline: true },
]

const PAGES: { id: string; label: string; Page: (p: PageProps) => React.ReactElement }[] = [
  { id: 'overview', label: 'Overview', Page: OverviewPage },
  { id: 'quality', label: 'Data quality', Page: QualityPage },
  { id: 'univariate', label: 'Univariate', Page: UnivariatePage },
  { id: 'bivariate', label: 'Bivariate', Page: BivariatePage },
  { id: 'multivariate', label: 'Multivariate', Page: MultivariatePage },
  { id: 'insights', label: 'Insights', Page: InsightsPage },
  { id: 'plan', label: 'Plan & method', Page: PlanPage },
]
/** "Ask AI" comes first; it stays mounted (hidden) so the conversation survives switching tabs. */
const TABS = [{ id: 'ask', label: 'Ask AI', icon: MessagesSquare }, ...PAGES.map(({ id, label }) => ({ id, label }))]

interface Props {
  config: AppConfig | null
  /** The uploaded file: "Ask AI" sends it with each question (the server is stateless). */
  file: File | null
  context: BusinessContext
  onContext: (context: BusinessContext) => void
  events: AgentEvent[]
  running: boolean
  report: AgentReport | null
  error: string | null
  onRun: () => void
  onExplore: (spec: AnalysisSpec) => void
  onDownload: (format: ReportFormat) => void
  downloading: ReportFormat | null
}

export function AgentView({ config, file, context, onContext, events, running, report, error, onRun, onExplore, onDownload, downloading }: Props) {
  const [page, setPage] = useState('overview')
  const [askSeed, setAskSeed] = useState<{ text: string; nonce: number } | null>(null)
  const ev = useMemo(() => (report ? evidenceById(report) : new Map()), [report])
  const phases = report ? report.phases : phasesFromEvents(events, running)
  const ai = config?.agent?.mode === 'ai'
  const elapsed = useElapsed(running)
  const activity = useMemo(() => activityFromEvents(events), [events])
  const calculations = useMemo(() => {
    const counts = new Map<number, number>()
    for (const e of events) if (e.type === 'tool' && !e.error) counts.set(e.phase, (counts.get(e.phase) ?? 0) + (e.count ?? 1))
    return counts
  }, [events])

  if (!report && !running) {
    return (
      <Card
        title="AI analyst"
        subtitle="Runs your full analytics workflow on this file: business context → data understanding → problem discovery → preparation → EDA → validated insights → dashboard."
        icon={Bot}
        highlight
        actions={ai ? <Badge tone="accent" icon={Sparkles}>{aiAnalystLabel(config?.agent)}</Badge> : <Badge>Rules-based (AI not configured)</Badge>}
      >
        <div className="mb-4 grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <p className="text-sm text-ink-2">
            <strong className="text-ink">Phase 0: business context.</strong> Every field is optional; the more you add, the more focused the questions and
            recommendations.{' '}
            <span className="tabular text-ink-muted">
              {FIELDS.filter((f) => context[f.key].trim()).length} of {FIELDS.length} answered.
            </span>
          </p>
          <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-ink-2">
            <Info aria-hidden className="mt-px size-3.5 shrink-0 text-accent-text" />
            <p>
              <strong className="text-ink">If you leave a field blank,</strong> the analyst states an assumption instead of inventing a fact. Phase 0 then
              shows “Passed (assumptions)” and the assumptions are listed under Plan &amp; method for you to confirm.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.multiline ? 'md:col-span-2' : ''}>
              <label htmlFor={`ctx-${f.key}`} className={labelClass}>
                {f.label}
              </label>
              {f.multiline ? (
                <textarea
                  id={`ctx-${f.key}`}
                  rows={2}
                  maxLength={1000}
                  value={context[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => onContext({ ...context, [f.key]: e.target.value })}
                  className={`${inputClass} py-2`}
                />
              ) : (
                <input
                  id={`ctx-${f.key}`}
                  value={context[f.key]}
                  maxLength={f.key === 'audience' ? 200 : f.key === 'objective' ? 500 : 300}
                  placeholder={f.placeholder}
                  onChange={(e) => onContext({ ...context, [f.key]: e.target.value })}
                  className={inputClass}
                />
              )}
            </div>
          ))}
        </div>
        {error && (
          <div className="mt-4">
            <Alert kind="error" title="The analysis could not run">
              <span>{error}</span> <span>Select <strong>Run the AI analyst</strong> to try again.</span>
            </Alert>
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" icon={Sparkles} onClick={onRun} className="w-full sm:w-auto">
            Run the AI analyst
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
            {ai ? 'The AI sees column names, statistics and category labels, never raw rows. Every number is calculated in Python.' : 'Every number is calculated in Python; nothing is stored.'}
          </span>
        </div>
      </Card>
    )
  }

  if (running) {
    const current = phases.find((p) => p.status === 'running')
    const done = phases.filter((p) => DONE.includes(p.status)).length
    const blocked = phases.filter((p) => p.status === 'blocked')
    return (
      <Card
        title="The analyst is working"
        subtitle="Each phase must pass its exit checks before the next one starts. Updates appear as they happen."
        icon={Bot}
        actions={
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            <Clock aria-hidden className="size-3.5" />
            <span className="tabular">{elapsedText(elapsed)} elapsed</span>
          </span>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2/60 p-3">
          <IconChip icon={current ? LoaderCircle : CircleCheck} tone={current ? 'brand' : 'good'} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink-muted">Now</p>
            <p className="text-sm font-semibold text-ink" aria-live="polite">
              {current ? `Phase ${current.id} · ${current.name}` : 'Finishing the report'}
            </p>
          </div>
          <Badge tone="accent">
            {done} of {phases.length} phases complete
          </Badge>
        </div>
        {blocked.length > 0 && (
          <div className="mb-4">
            <Alert kind="warning" title={`${blocked.length === 1 ? 'A phase' : `${blocked.length} phases`} did not pass ${blocked.length === 1 ? 'its' : 'their'} exit checks`}>
              The analyst continues and the report marks what is affected: {blocked.map((p) => `phase ${p.id} (${p.name})`).join(', ')}.
            </Alert>
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-w-0">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Phases</h3>
            <PhaseSteps phases={phases} calculations={calculations} />
          </div>
          <div className="min-w-0">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Activity (newest first)</h3>
            <ActivityFeed items={activity} />
          </div>
        </div>
      </Card>
    )
  }

  const rep = report as AgentReport
  const Page = (PAGES.find((p) => p.id === page) ?? PAGES[0]).Page
  const passed = rep.phases.filter((p) => p.status === 'passed' || p.status === 'passed_with_assumptions').length
  const askAbout = ai
    ? (question: string) => {
        setAskSeed({ text: question, nonce: Date.now() })
        setPage('ask')
      }
    : undefined
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card
        title={`Analysis of ${rep.dataset.file_name}`}
        subtitle={`${rep.mode === 'ai' ? `AI analyst (${rep.model})` : 'Rules-based analyst'} · ${rep.duration_seconds}s · ${rep.evidence.length} calculations recorded as evidence`}
        icon={Bot}
        actions={
          <>
            <Button size="sm" variant="primary" icon={FileText} busy={downloading === 'pdf'} onClick={() => onDownload('pdf')}>
              Download PDF
            </Button>
            <Button size="sm" variant="primary" icon={Presentation} busy={downloading === 'pptx'} onClick={() => onDownload('pptx')}>
              Download PowerPoint
            </Button>
            <Button size="sm" icon={Download} onClick={() => saveBlob(new Blob([rep.handover_markdown], { type: 'text/markdown;charset=utf-8' }), `tabulavibe_handover_${rep.dataset.file_name.replace(/\.[^.]+$/, '')}.md`)}>
              Download handover (.md)
            </Button>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRun}>
              Run again
            </Button>
          </>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <Badge tone={passed === rep.phases.length ? 'good' : 'warn'} icon={passed === rep.phases.length ? CircleCheck : TriangleAlert}>
            {passed} of {rep.phases.length} phases passed
          </Badge>
          {rep.evaluation && (
            <span>
              <strong className="text-ink">Built by:</strong> {rep.mode === 'ai' ? `AI analyst (${providerModel(rep.provider, rep.model)})` : 'rules-based analyst'}
              {rep.evaluation.candidates.length > 1 && ` · scored ${rep.evaluation.candidates.map((c) => `${c.mode === 'ai' ? 'AI' : 'rules'} ${formatNumber(c.score)}`).join(' vs ')}`}
            </span>
          )}
        </div>
        <PhaseTimeline phases={phases} />
        {(rep.provider_switches ?? []).length > 0 && (
          <div className="mt-4">
            <Alert kind="info" title="AI provider switched during the run">
              {(rep.provider_switches ?? []).join('. ')}.
            </Alert>
          </div>
        )}
        {rep.ai_note && (
          <div className="mt-4">
            <Alert kind="warning" title={rep.evaluation?.winner === 'rules' && rep.evaluation.candidates.length > 1 ? 'The rules-based analysis scored higher' : 'AI analyst not used'}>
              {rep.ai_note}
            </Alert>
          </div>
        )}
        {rep.dashboard.unverified_findings.length > 0 && (
          <div className="mt-4">
            <Alert kind="warning" title="Some findings could not be verified">
              {rep.dashboard.unverified_findings.join(', ')} contain figures that do not match a calculation. They are excluded from the overview.
            </Alert>
          </div>
        )}
      </Card>
      <TabBar label="Analyst report pages" tabs={TABS} value={page} onChange={setPage} />
      <div role="tabpanel" aria-label="Ask AI" hidden={page !== 'ask'} className="animate-rise min-w-0">
        <AskAI key={rep.generated_at} file={file} report={rep} aiEnabled={ai} seed={askSeed} />
      </div>
      {page !== 'ask' && (
        <div role="tabpanel" aria-label={PAGES.find((p) => p.id === page)?.label} className="animate-rise min-w-0">
          <Page report={rep} ev={ev} onExplore={onExplore} onAsk={askAbout} />
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-ink-muted">
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        Findings describe associations in this file, not causes. Explanations are possibilities to check. For filters, date ranges and exports, use “Explore in Analyse”, which runs on the same metric engine.
      </p>
    </div>
  )
}

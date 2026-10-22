import { useMemo, useState } from 'react'
import { Bot, CircleCheck, CircleDashed, CircleSlash, CircleX, Download, FileText, LoaderCircle, Presentation, RotateCcw, ShieldCheck, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react'
import { aiAnalystLabel, evidenceById, providerModel, PHASE_STATUS_LABEL, phasesFromEvents, type AgentEvent, type AgentReport, type BusinessContext, type Phase, type PhaseStatus } from '../../lib/agent'
import type { AnalysisSpec, AppConfig } from '../../lib/types'
import { saveBlob, type ReportFormat } from '../../lib/api'
import { formatNumber } from '../../lib/format'
import { Alert, Badge, Button, Card, labelClass } from '../ui'
import { BivariatePage, InsightsPage, MultivariatePage, OverviewPage, PlanPage, QualityPage, UnivariatePage, type PageProps } from './AgentPages'

const STATUS_ICON: Record<PhaseStatus, { icon: LucideIcon; className: string }> = {
  pending: { icon: CircleDashed, className: 'text-ink-muted' },
  running: { icon: LoaderCircle, className: 'animate-spin text-accent' },
  passed: { icon: CircleCheck, className: 'text-good' },
  passed_with_assumptions: { icon: CircleCheck, className: 'text-accent' },
  blocked: { icon: CircleX, className: 'text-bad' },
  skipped: { icon: CircleSlash, className: 'text-ink-muted' },
}

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

interface Props {
  config: AppConfig | null
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

export function AgentView({ config, context, onContext, events, running, report, error, onRun, onExplore, onDownload, downloading }: Props) {
  const [page, setPage] = useState('overview')
  const ev = useMemo(() => (report ? evidenceById(report) : new Map()), [report])
  const phases = report ? report.phases : phasesFromEvents(events, running)
  const ai = config?.agent?.mode === 'ai'
  const activity = events.filter((e) => e.type === 'tool' || e.type === 'log').slice(-5)

  if (!report && !running) {
    return (
      <Card
        title="AI analyst"
        subtitle="Runs your full analytics workflow on this file: business context → data understanding → problem discovery → preparation → EDA → validated insights → dashboard."
        icon={Bot}
        highlight
        actions={ai ? <Badge tone="accent" icon={Sparkles}>{aiAnalystLabel(config?.agent)}</Badge> : <Badge>Rules-based (AI not configured)</Badge>}
      >
        <p className="mb-4 text-sm text-ink-2">
          <strong>Phase 0: business context.</strong> Every field is optional. Gaps are recorded as assumptions in the charter, never invented as facts.
        </p>
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
                  className="w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-soft transition hover:border-accent/50 focus:border-accent"
                />
              ) : (
                <input
                  id={`ctx-${f.key}`}
                  value={context[f.key]}
                  maxLength={f.key === 'audience' ? 200 : f.key === 'objective' ? 500 : 300}
                  placeholder={f.placeholder}
                  onChange={(e) => onContext({ ...context, [f.key]: e.target.value })}
                  className="min-h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink shadow-soft transition hover:border-accent/50 focus:border-accent"
                />
              )}
            </div>
          ))}
        </div>
        {error && (
          <div className="mt-4">
            <Alert kind="error" title="The analysis could not run">
              {error}
            </Alert>
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" icon={Sparkles} onClick={onRun}>
            Run the AI analyst
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            <ShieldCheck aria-hidden className="size-3.5" />
            {ai ? 'The AI sees column names, statistics and category labels, never raw rows. Every number is calculated in Python.' : 'Every number is calculated in Python; nothing is stored.'}
          </span>
        </div>
      </Card>
    )
  }

  if (running) {
    return (
      <Card title="The analyst is working" subtitle="Each phase must pass its exit checks before the next one starts." icon={Bot}>
        <PhaseTimeline phases={phases} />
        <ul aria-label="Analyst activity" aria-live="polite" className="mt-4 grid gap-1 text-xs text-ink-muted">
          {activity.map((e, i) => (
            <li key={i} className="tabular">
              {e.type === 'tool' ? `Phase ${e.phase}: ${e.name.replace(/_/g, ' ')}${e.evidence_id ? ` → ${e.evidence_id}` : ''}${e.error ? ` (refused: ${e.error})` : ''}${e.count ? ` × ${e.count}` : ''}` : e.type === 'log' ? e.message : ''}
            </li>
          ))}
        </ul>
      </Card>
    )
  }

  const rep = report as AgentReport
  const Page = (PAGES.find((p) => p.id === page) ?? PAGES[0]).Page
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
        <PhaseTimeline phases={phases} />
        {rep.evaluation && (
          <p className="mt-4 text-sm text-ink-2">
            <strong className="text-ink">Built by:</strong> {rep.mode === 'ai' ? `AI analyst (${providerModel(rep.provider, rep.model)})` : 'rules-based analyst'}
            {rep.evaluation.candidates.length > 1 && ` · scored ${rep.evaluation.candidates.map((c) => `${c.mode === 'ai' ? 'AI' : 'rules'} ${formatNumber(c.score)}`).join(' vs ')}`}
          </p>
        )}
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
      <nav aria-label="Analyst report pages" className="overflow-x-auto print:hidden">
        <div role="tablist" className="flex w-max min-w-full gap-1 rounded-2xl bg-surface-2 p-1 ring-1 ring-inset ring-line">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={page === p.id}
              onClick={() => setPage(p.id)}
              className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${page === p.id ? 'bg-surface text-ink shadow-soft ring-1 ring-line' : 'text-ink-muted hover:text-ink'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </nav>
      <div role="tabpanel" aria-label={PAGES.find((p) => p.id === page)?.label} className="animate-rise min-w-0">
        <Page report={rep} ev={ev} onExplore={onExplore} />
      </div>
      <p className="flex items-start gap-2 text-xs text-ink-muted">
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        Findings describe associations in this file, not causes. Explanations are possibilities to check. For filters, date ranges and exports, use “Explore in Analyse”, which runs on the same metric engine.
      </p>
    </div>
  )
}

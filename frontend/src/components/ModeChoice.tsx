import { ArrowRight, Check, Cpu, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react'
import { aiAnalystLabel } from '../lib/agent'
import { formatCount } from '../lib/format'
import type { AppConfig, Profile } from '../lib/types'
import { Badge } from './ui'

export type AnalysisMode = 'ai' | 'manual'

interface Option {
  mode: AnalysisMode
  name: string
  icon: LucideIcon
  tagline: string
  bestFor: string
  youProvide: string
  points: string[]
  cta: string
}

const OPTIONS: Option[] = [
  {
    mode: 'ai',
    name: 'AI Analyst',
    icon: Sparkles,
    tagline: 'Guided analysis: the analyst runs the full workflow and hands you a validated report.',
    bestFor: 'A quick, complete picture when you are not sure where to start.',
    youProvide: 'Optional business context (what the data is, who it is for).',
    points: [
      'Profiles the data, registers questions and tests hypotheses',
      'Every number is calculated in Python and checked against its evidence',
      'Findings with evidence, recommendations and limitations; Ask AI follow-ups',
      'Final report as PDF, PowerPoint or a Markdown handover',
    ],
    cta: 'Start with the AI Analyst',
  },
  {
    mode: 'manual',
    name: 'Manual Analyst',
    icon: SlidersHorizontal,
    tagline: 'Hands-on exploration: four steps where you choose exactly what to calculate.',
    bestFor: 'A specific question, or checking a figure yourself.',
    youProvide: 'Your choice of measures, grouping, filters and cleaning options.',
    points: ['1. Preview the data', '2. Check its quality', '3. Build KPIs and charts with suggestions', '4. Report as PDF or PowerPoint, data as CSV'],
    cta: 'Analyse manually',
  },
]

/** Shown after a file is uploaded: choose between the AI Analyst and the Manual Analyst. */
export function ModeChoice({ profile, config, onChoose }: { profile: Profile; config: AppConfig | null; onChoose: (mode: AnalysisMode) => void }) {
  const { dataset } = profile
  const ai = config?.agent?.mode === 'ai'
  return (
    <section className="animate-rise mx-auto grid w-full max-w-5xl gap-6" aria-labelledby="mode-title">
      <div className="text-center">
        <h1 id="mode-title" className="text-balance text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          How would you like to analyse <span className="brand-text">{dataset.file_name || 'your file'}</span>?
        </h1>
        <ul className="mt-3 flex flex-wrap justify-center gap-2" aria-label="File summary">
          <li>
            <Badge>{formatCount(dataset.row_count)} rows</Badge>
          </li>
          <li>
            <Badge>{dataset.column_count} columns</Badge>
          </li>
          <li>
            <Badge tone={dataset.valid_cell_pct >= 95 ? 'good' : 'warn'}>{dataset.valid_cell_pct}% data health</Badge>
          </li>
        </ul>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            aria-label={o.name}
            onClick={() => onChoose(o.mode)}
            className="group flex min-w-0 flex-col rounded-3xl border border-line bg-surface p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-float focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent sm:p-6"
          >
            <span className="flex flex-wrap items-start justify-between gap-3">
              <span aria-hidden className={`grid size-12 place-items-center rounded-2xl ${o.mode === 'ai' ? 'brand-gradient text-white shadow-[0_10px_24px_-10px_rgb(79_70_229/0.8)]' : 'bg-accent-soft text-accent-text'}`}>
                <o.icon className="size-6" />
              </span>
              {o.mode === 'ai' &&
                (ai ? (
                  <Badge tone="good" icon={Sparkles}>
                    LLM available: {aiAnalystLabel(config?.agent)}
                  </Badge>
                ) : (
                  <Badge icon={Cpu}>Rules-based (AI not configured)</Badge>
                ))}
            </span>
            <span className="mt-4 text-xl font-bold tracking-tight text-ink">{o.name}</span>
            <span className="mt-1 text-sm text-ink-2">{o.tagline}</span>
            {o.mode === 'ai' && !ai && (
              <span className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-2">
                No language model is configured on this server, so the same nine-phase workflow runs with documented rules. Findings, checks and
                exports work the same; Ask AI needs a model.
              </span>
            )}
            <dl className="mt-4 grid gap-2 text-sm">
              <div>
                <dt className="text-xs font-semibold text-ink-muted">Best for</dt>
                <dd className="text-ink-2">{o.bestFor}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-ink-muted">You provide</dt>
                <dd className="text-ink-2">{o.youProvide}</dd>
              </div>
            </dl>
            <ul className="mt-4 grid gap-2 border-t border-line pt-4">
              {o.points.map((pt) => (
                <li key={pt} className="flex items-start gap-2 text-sm text-ink-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-good" />
                  {pt}
                </li>
              ))}
            </ul>
            <span className="brand-gradient mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition group-hover:brightness-110 sm:w-fit">
              {o.cta}
              <ArrowRight aria-hidden className="size-4 transition group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-ink-muted">You can switch between the two at any time; your file stays loaded.</p>
    </section>
  )
}

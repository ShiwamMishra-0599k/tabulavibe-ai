import { ArrowRight, Check, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react'
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
  points: string[]
  cta: string
}

const OPTIONS: Option[] = [
  {
    mode: 'ai',
    name: 'AI Analyst',
    icon: Sparkles,
    tagline: 'Let the analyst run the full workflow and hand you a validated dashboard.',
    points: [
      'Understands the data, finds problems and tests hypotheses',
      'Every number is calculated in Python and checked',
      'Dashboard with KPIs, charts and insight cards',
      'Final report as PDF or PowerPoint',
    ],
    cta: 'Start with the AI Analyst',
  },
  {
    mode: 'manual',
    name: 'Manual Analyst',
    icon: SlidersHorizontal,
    tagline: 'Explore step by step and build exactly the analysis you want.',
    points: ['Preview the data and check its quality', 'Choose your own KPIs, groupings and filters', 'Download results and cleaned data as CSV', 'Final report as PDF or PowerPoint'],
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
      <div className="grid gap-4 md:grid-cols-2">
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            aria-label={o.name}
            onClick={() => onChoose(o.mode)}
            className={`group flex min-w-0 flex-col rounded-3xl p-6 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-float focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${
              o.mode === 'ai' ? 'gradient-border' : 'border border-line bg-surface hover:border-accent/40'
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span aria-hidden className={`grid size-12 place-items-center rounded-2xl ${o.mode === 'ai' ? 'brand-gradient text-white shadow-[0_10px_24px_-10px_rgb(79_70_229/0.8)]' : 'bg-accent-soft text-accent-text'}`}>
                <o.icon className="size-6" />
              </span>
              {o.mode === 'ai' && (
                <Badge tone="accent" icon={Sparkles}>
                  {ai ? aiAnalystLabel(config?.agent) : 'Rules-based (AI not configured)'}
                </Badge>
              )}
            </span>
            <span className="mt-4 text-xl font-bold tracking-tight text-ink">{o.name}</span>
            <span className="mt-1 text-sm text-ink-2">{o.tagline}</span>
            <ul className="mt-4 grid gap-2">
              {o.points.map((pt) => (
                <li key={pt} className="flex items-start gap-2 text-sm text-ink-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-good" />
                  {pt}
                </li>
              ))}
            </ul>
            <span
              className={`mt-6 inline-flex w-fit items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                o.mode === 'ai' ? 'brand-gradient text-white group-hover:brightness-110' : 'border border-line-strong bg-surface text-ink group-hover:border-accent/50'
              }`}
            >
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

import { ChartNoAxesColumn } from 'lucide-react'
import type { AnalysisResult, Issue, Narrative, Profile } from '../lib/types'
import { formatCount, formatNumber, formatPercent, LOCALE } from '../lib/format'
import { chartTitle, type ChartKind } from '../lib/charts'
import { ChartView, KpiCards, ResultsTable } from './Dashboard'
import { NarrativeText } from './AiNarrative'

interface Props {
  /** Dataset summary and issues: from the live profile, or from a saved report. */
  dataset: Profile['dataset']
  issues: Issue[]
  result: AnalysisResult
  narrative: Narrative | null
  chartKind: ChartKind
  measureKey: string
  preparedAt: Date
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
      <span aria-hidden className="h-5 w-1 rounded-full brand-gradient" />
      {children}
    </h2>
  )
}

/** Headline facts for the executive summary: values the server calculated, picked by ordering only. */
function summaryPoints(result: AnalysisResult, measureKey: string, dataset: Props['dataset']): string[] {
  const points = result.kpis.slice(0, 3).map((k) => `${k.label}: ${formatNumber(k.value)}`)
  const measure = result.measures.find((m) => m.key === measureKey) ?? result.measures[0]
  const rows = result.rows.filter((r) => r.values[measure.key] !== null)
  if (result.grouping && rows.length > 1) {
    const sorted = [...rows].sort((a, b) => (b.values[measure.key] ?? 0) - (a.values[measure.key] ?? 0))
    const top = sorted[0]
    const low = sorted[sorted.length - 1]
    points.push(`Highest ${measure.label}: ${top.group} (${formatNumber(top.values[measure.key])})`)
    points.push(`Lowest ${measure.label}: ${low.group} (${formatNumber(low.values[measure.key])})`)
    if (result.grouping.type === 'date') {
      const latest = rows[rows.length - 1]
      points.push(`Latest period: ${latest.group} (${formatNumber(latest.values[measure.key])})`)
    }
  }
  points.push(`Data health ${dataset.valid_cell_pct}%: ${formatCount(dataset.missing_cell_count)} missing cells and ${formatCount(dataset.duplicate_row_count)} duplicate rows detected.`)
  return points
}

/** Management-report layout. Printed via the browser (Print → Save as PDF). */
export function ReportView({ dataset, issues, result, narrative, chartKind, measureKey, preparedAt }: Props) {
  const filters = result.spec.filters
  const warnings = issues.filter((i) => i.severity === 'warning')
  const summary = summaryPoints(result, measureKey, dataset)
  return (
    <article id="report" className="mx-auto grid w-full max-w-4xl gap-8 overflow-hidden rounded-3xl border border-line bg-surface shadow-float print:rounded-none print:border-0 print:shadow-none">
      <header className="brand-gradient relative px-6 py-8 text-white sm:px-10 print:border-b print:border-line print:bg-none print:px-0 print:text-ink">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/80 print:text-ink-muted">
          <ChartNoAxesColumn aria-hidden className="size-4" />
          TabulaVibe AI · Business report
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{chartTitle(result, measureKey)}</h1>
        <p className="mt-2 text-sm text-white/85 print:text-ink-2">
          Source: {dataset.file_name || 'uploaded file'}
          {dataset.sheet_name ? ` (sheet "${dataset.sheet_name}")` : ''} · Prepared{' '}
          {preparedAt.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </header>

      <div className="grid gap-8 px-6 pb-8 sm:px-10 print:px-0">
        <section className="print-avoid-break rounded-2xl border border-line bg-surface-2/60 p-5" aria-labelledby="exec-summary">
          <h2 id="exec-summary" className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Executive summary
          </h2>
          <ul className="mt-3 grid gap-2 text-sm text-ink">
            {summary.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full brand-gradient" />
                <span className="tabular">{p}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-muted">Observed figures from the uploaded file. They describe what happened, not why.</p>
        </section>

        <section className="print-avoid-break">
          <SectionTitle>Scope</SectionTitle>
          <ul className="grid gap-1.5 text-sm text-ink-2">
            <li>
              • {formatCount(result.rows_analyzed)} of {formatCount(dataset.row_count)} rows analysed across {dataset.column_count} columns.
            </li>
            <li>• {result.spec.remove_duplicates ? 'Exact duplicate rows were excluded.' : `Duplicate rows were kept (${dataset.duplicate_row_count} found).`}</li>
            {result.spec.merge_label_variants && <li>• Labels differing only by letter case or spacing were merged.</li>}
            {filters.length === 0 && <li>• No filters applied.</li>}
            {filters.map((f) => (
              <li key={f.column}>
                • Filter on {f.column}: {f.values ? f.values.join(', ') : `${f.start ?? 'start'} to ${f.end ?? 'end'}`}
              </li>
            ))}
            {result.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        </section>

        <section>
          <SectionTitle>Key figures</SectionTitle>
          <KpiCards result={result} />
        </section>

        {result.grouping && result.rows.length > 0 && (
          <>
            {chartKind !== 'table' && (
              <section className="print-avoid-break">
                <SectionTitle>Chart</SectionTitle>
                <ChartView result={result} kind={chartKind} measureKey={measureKey} />
              </section>
            )}
            <section>
              <SectionTitle>Detailed results</SectionTitle>
              <ResultsTable result={result} />
            </section>
          </>
        )}

        {narrative && (
          <section className="print-avoid-break rounded-2xl border border-line bg-surface-2/60 p-5">
            <SectionTitle>Commentary</SectionTitle>
            <NarrativeText narrative={narrative} />
          </section>
        )}

        <section className="print-avoid-break">
          <SectionTitle>Data quality</SectionTitle>
          <p className="text-sm text-ink-2">
            Data health {dataset.valid_cell_pct}%. {formatCount(dataset.missing_cell_count)} missing cells ({formatPercent(dataset.missing_cell_pct)}) and{' '}
            {formatCount(dataset.duplicate_row_count)} duplicate rows were detected. Missing and invalid values are excluded from calculations and
            were not altered.
          </p>
          {warnings.length > 0 && (
            <ul className="mt-2 grid gap-1 text-sm text-ink-2">
              {warnings.map((w) => (
                <li key={w.message}>• {w.message}</li>
              ))}
            </ul>
          )}
        </section>

        <footer className="border-t border-line pt-4 text-xs text-ink-muted">
          Figures were calculated by TabulaVibe AI from the uploaded file. Definitions are listed under each key figure. This report was
          generated by a demonstration tool and should be reviewed before it is relied on for decisions.
        </footer>
      </div>
    </article>
  )
}

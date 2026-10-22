import { useState } from 'react'
import { ChartColumn, ChartLine, ChartPie, CircleHelp, Hash, Sigma, Table2, TrendingDown, TrendingUp, ArrowDownToLine, ArrowUpToLine, type LucideIcon } from 'lucide-react'
import { chartTitle, type ChartKind } from '../lib/charts'
import type { AnalysisResult, Kpi } from '../lib/types'
import { formatCount, formatNumber } from '../lib/format'
import { BarComparison, ShareChart, TrendChart } from './Charts'
import { Alert, Badge, Card, IconChip, labelClass, selectClass } from './ui'

const KPI_ICONS: Record<Kpi['aggregation'], LucideIcon> = {
  sum: Sigma,
  mean: TrendingUp,
  count: Hash,
  min: ArrowDownToLine,
  max: ArrowUpToLine,
}

export function KpiCards({ result }: { result: AnalysisResult }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-3">
      {result.kpis.map((k, i) => (
        <div
          key={k.key}
          className={`animate-rise print-avoid-break relative overflow-hidden rounded-2xl p-5 shadow-card ${i === 0 ? 'gradient-border' : 'border border-line bg-surface'}`}
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink-2">{k.label}</p>
            <IconChip icon={k.column === null ? Hash : KPI_ICONS[k.aggregation]} tone={i === 0 ? 'brand' : 'accent'} size="sm" />
          </div>
          <p className="tabular mt-2 break-words text-2xl font-bold tracking-tight text-ink sm:text-3xl">{formatNumber(k.value)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="neutral">{formatCount(k.values_used)} values used</Badge>
            {k.values_excluded > 0 && (
              <Badge tone="warn" icon={TrendingDown}>
                {formatCount(k.values_excluded)} excluded
              </Badge>
            )}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">{k.definition}</p>
        </div>
      ))}
    </div>
  )
}

export function ResultsTable({ result }: { result: AnalysisResult }) {
  if (!result.grouping) return null
  return (
    <div className="overflow-x-auto rounded-xl border border-line" tabIndex={0} aria-label="Grouped results table">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Results grouped by {result.grouping.column}</caption>
        <thead className="bg-surface-2">
          <tr className="text-xs text-ink-muted">
            <th scope="col" className="px-3 py-2.5 font-medium">
              {result.grouping.column}
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Rows
            </th>
            {result.measures.map((m) => (
              <th key={m.key} scope="col" className="px-3 py-2.5 text-right font-medium">
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.group} className="border-t border-line transition-colors hover:bg-accent-soft/40">
              <th scope="row" className="px-3 py-2 font-semibold text-ink">
                {r.group}
              </th>
              <td className="tabular px-3 py-2 text-right text-ink-2">{formatCount(r.row_count)}</td>
              {result.measures.map((m) => (
                <td key={m.key} className="tabular px-3 py-2 text-right text-ink">
                  {formatNumber(r.values[m.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ChartView({ result, kind, measureKey }: { result: AnalysisResult; kind: ChartKind; measureKey: string }) {
  const measure = result.measures.find((m) => m.key === measureKey) ?? result.measures[0]
  if (!result.grouping || result.rows.length === 0) return null
  if (kind === 'table') return <ResultsTable result={result} />
  if (kind === 'line') return <TrendChart rows={result.rows} measureKey={measure.key} measureLabel={measure.label} />
  if (kind === 'pie') {
    // The donut centre shows the server-calculated KPI for this measure.
    const total = result.kpis.find((k) => k.key === measure.key)?.value ?? null
    return <ShareChart rows={result.rows} measureKey={measure.key} measureLabel={measure.label} total={total} />
  }
  return <BarComparison rows={result.rows} measureKey={measure.key} measureLabel={measure.label} />
}

interface DashboardProps {
  result: AnalysisResult
  chartKind: ChartKind
  measureKey: string
  onChartKind: (kind: ChartKind) => void
  onMeasureKey: (key: string) => void
}

const KIND_ICONS: Record<ChartKind, LucideIcon> = { line: ChartLine, bar: ChartColumn, pie: ChartPie, table: Table2 }

export function Dashboard({ result, chartKind, measureKey, onChartKind, onMeasureKey }: DashboardProps) {
  const [showWhy, setShowWhy] = useState(false)
  const isTime = result.grouping?.type === 'date'
  const kinds: { kind: ChartKind; label: string; disabled?: boolean }[] = [
    isTime ? { kind: 'line', label: 'Line' } : { kind: 'bar', label: 'Bar' },
    ...(isTime ? [{ kind: 'bar' as ChartKind, label: 'Bar' }] : []),
    { kind: 'pie', label: 'Donut', disabled: !result.chart.pie_allowed },
    { kind: 'table', label: 'Table' },
  ]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <Badge tone="accent">
          {formatCount(result.rows_analyzed)} of {formatCount(result.row_count)} rows analysed
        </Badge>
        {result.grouping && (
          <Badge>
            {formatCount(result.grouping.total_groups)} group(s) by {result.grouping.column}
            {result.grouping.time_grain ? ` · ${result.grouping.time_grain}` : ''}
          </Badge>
        )}
      </div>
      {result.notes.map((n) => (
        <Alert key={n} kind="info">
          {n}
        </Alert>
      ))}
      <KpiCards result={result} />

      {result.grouping && result.rows.length > 0 && (
        <Card
          className="animate-rise"
          title={chartTitle(result, measureKey)}
          actions={
            <div role="group" aria-label="Chart type" className="grid w-full grid-cols-4 rounded-xl bg-surface-2 p-1 ring-1 ring-inset ring-line sm:flex sm:w-auto">
              {kinds.map(({ kind, label, disabled }) => {
                const Icon = KIND_ICONS[kind]
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={disabled}
                    aria-pressed={chartKind === kind}
                    title={disabled ? (result.chart.pie_reason ?? undefined) : undefined}
                    onClick={() => onChartKind(kind)}
                    className={`flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition sm:px-3 disabled:cursor-not-allowed disabled:opacity-35 ${
                      chartKind === kind ? 'bg-surface text-ink shadow-soft ring-1 ring-line' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Icon aria-hidden className={`size-3.5 ${chartKind === kind ? 'text-accent' : ''}`} />
                    <span className="max-[379px]:sr-only">{label}</span>
                  </button>
                )
              })}
            </div>
          }
        >
          {result.measures.length > 1 && chartKind !== 'table' && (
            <div className="mb-4 max-w-xs">
              <label className={labelClass} htmlFor="chart-measure">
                Measure shown in chart
              </label>
              <select id="chart-measure" className={selectClass} value={measureKey} onChange={(e) => onMeasureKey(e.target.value)}>
                {result.measures.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <ChartView result={result} kind={chartKind} measureKey={measureKey} />
          <div className="mt-4 grid gap-1 text-xs text-ink-muted">
            {result.chart.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
            {!result.chart.pie_allowed && result.chart.pie_reason && (
              <div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
                  aria-expanded={showWhy}
                  onClick={() => setShowWhy((v) => !v)}
                >
                  <CircleHelp aria-hidden className="size-3.5" />
                  Why is the donut chart unavailable?
                </button>
                {showWhy && <span className="animate-rise mt-1 block rounded-lg bg-surface-2 p-2 text-ink-2">{result.chart.pie_reason}</span>}
              </div>
            )}
          </div>
        </Card>
      )}

      {result.grouping && result.rows.length === 0 && (
        <Alert kind="info" title="No groups to show">
          No rows match the selected filters.
        </Alert>
      )}

      {result.grouping && chartKind !== 'table' && result.rows.length > 0 && (
        <Card icon={Table2} title="Results table">
          <ResultsTable result={result} />
        </Card>
      )}
    </div>
  )
}

import { useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChevronDown,
  CircleHelp,
  Copy,
  Filter,
  Hash,
  Rows3,
  Sigma,
  Table2,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { chartTitle, type ChartKind } from '../lib/charts'
import type { AnalysisResult, FilterSpec, Kpi } from '../lib/types'
import { formatCount, formatNumber } from '../lib/format'
import { BarComparison, ShareChart, TrendChart } from './Charts'
import { Alert, Badge, Card, KpiTile, SegmentedControl, selectClass } from './ui'

const KPI_ICONS: Record<Kpi['aggregation'], LucideIcon> = {
  sum: Sigma,
  mean: TrendingUp,
  count: Hash,
  min: ArrowDownToLine,
  max: ArrowUpToLine,
}

const AGGREGATION_LABEL: Record<Kpi['aggregation'], string> = { sum: 'Total', mean: 'Average', count: 'Count', min: 'Minimum', max: 'Maximum' }

export function KpiCards({ result }: { result: AnalysisResult }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(14rem,100%),1fr))] gap-3">
      {result.kpis.map((k, i) => (
        <KpiTile
          key={k.key}
          label={k.label}
          value={formatNumber(k.value)}
          icon={k.column === null ? Hash : KPI_ICONS[k.aggregation]}
          lead={i === 0}
          delay={i * 50}
          meta={
            <>
              <Badge tone={i === 0 ? 'accent' : 'neutral'}>{AGGREGATION_LABEL[k.aggregation]}</Badge>
              <Badge tone="neutral">{formatCount(k.values_used)} values used</Badge>
              {k.values_excluded > 0 && (
                <Badge tone="warn" icon={TrendingDown}>
                  {formatCount(k.values_excluded)} excluded
                </Badge>
              )}
            </>
          }
          definition={k.definition}
        />
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

function filterText(f: FilterSpec): string {
  if (f.values?.length) return `${f.column}: ${f.values.slice(0, 3).join(', ')}${f.values.length > 3 ? ` +${f.values.length - 3}` : ''}`
  return `${f.column}: ${f.start ?? '…'} – ${f.end ?? '…'}`
}

/** What this result covers: rows, grouping and the active filters, so filters stay discoverable. */
function ScopeBar({ result }: { result: AnalysisResult }) {
  const filters = result.spec.filters
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2" aria-label="Analysis scope">
      <Badge tone="accent" icon={Rows3}>
        {formatCount(result.rows_analyzed)} of {formatCount(result.row_count)} rows analysed
      </Badge>
      {result.grouping && (
        <Badge>
          {formatCount(result.grouping.total_groups)} group(s) by {result.grouping.column}
          {result.grouping.time_grain ? ` · ${result.grouping.time_grain}` : ''}
        </Badge>
      )}
      {filters.length === 0 ? (
        <Badge icon={Filter}>No filters</Badge>
      ) : (
        filters.map((f) => (
          <Badge key={`${f.column}-${filterText(f)}`} tone="warn" icon={Filter}>
            {filterText(f)}
          </Badge>
        ))
      )}
      {result.spec.remove_duplicates && <Badge icon={Copy}>Duplicates removed</Badge>}
      <span className="text-ink-muted">· Change these in the builder.</span>
    </div>
  )
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
  const measure = result.measures.find((m) => m.key === measureKey) ?? result.measures[0]
  const kinds: { kind: ChartKind; label: string; disabled?: boolean }[] = [
    isTime ? { kind: 'line', label: 'Line' } : { kind: 'bar', label: 'Bar' },
    ...(isTime ? [{ kind: 'bar' as ChartKind, label: 'Bar' }] : []),
    { kind: 'pie', label: 'Donut', disabled: !result.chart.pie_allowed },
    { kind: 'table', label: 'Table' },
  ]
  const shown = Math.min(result.rows.length, 20)
  const subtitle = result.grouping
    ? `${AGGREGATION_LABEL[measure.aggregation]} per ${result.grouping.time_grain ?? 'group'} · ${formatCount(result.rows.length)} ${result.grouping.time_grain ? 'periods' : 'groups'}${
        chartKind === 'bar' && result.rows.length > shown ? ` · top ${shown} shown` : ''
      } · hover a ${chartKind === 'line' ? 'point' : 'bar'} for details`
    : undefined

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <ScopeBar result={result} />
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
          subtitle={chartKind === 'table' ? 'Every group with all measures' : subtitle}
          actions={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {result.measures.length > 1 && chartKind !== 'table' && (
                <>
                  <label className="sr-only" htmlFor="chart-measure">
                    Measure shown in chart
                  </label>
                  <select
                    id="chart-measure"
                    className={`${selectClass} min-h-9 w-full sm:w-52`}
                    value={measureKey}
                    onChange={(e) => onMeasureKey(e.target.value)}
                    title="Measure shown in chart"
                  >
                    {result.measures.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <SegmentedControl
                label="Chart type"
                stretch
                compactBelow380
                value={chartKind}
                onChange={onChartKind}
                options={kinds.map(({ kind, label, disabled }) => ({
                  value: kind,
                  label,
                  icon: KIND_ICONS[kind],
                  disabled,
                  title: disabled ? (result.chart.pie_reason ?? undefined) : undefined,
                }))}
              />
            </div>
          }
        >
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
        <details className="group rounded-2xl border border-line bg-surface shadow-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Table2 aria-hidden className="size-4 text-accent" />
              Results table
              <span className="font-normal text-ink-muted">· {formatCount(result.rows.length)} rows, every measure</span>
            </span>
            <ChevronDown aria-hidden className="size-4 text-ink-muted transition group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 sm:px-6 sm:pb-6">
            <ResultsTable result={result} />
          </div>
        </details>
      )}
    </div>
  )
}

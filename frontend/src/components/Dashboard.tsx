import { useState } from 'react'
import { chartTitle, type ChartKind } from '../lib/charts'
import type { AnalysisResult } from '../lib/types'
import { formatCount, formatNumber } from '../lib/format'
import { BarComparison, ShareChart, TrendChart } from './Charts'
import { Alert, Card, labelClass, selectClass } from './ui'


export function KpiCards({ result }: { result: AnalysisResult }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {result.kpis.map((k) => (
        <div key={k.key} className="print-avoid-break rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-ink-2">{k.label}</p>
          <p className="mt-1 text-3xl font-semibold text-ink">{formatNumber(k.value)}</p>
          <p className="mt-2 text-xs text-ink-muted">{k.definition}</p>
        </div>
      ))}
    </div>
  )
}

export function ResultsTable({ result }: { result: AnalysisResult }) {
  if (!result.grouping) return null
  return (
    <div className="overflow-x-auto" tabIndex={0} aria-label="Grouped results table">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Results grouped by {result.grouping.column}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-medium">{result.grouping.column}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Rows</th>
            {result.measures.map((m) => (
              <th key={m.key} scope="col" className="py-2 pr-3 text-right font-medium">
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.group} className="border-b border-line">
              <th scope="row" className="py-1.5 pr-3 font-medium text-ink">{r.group}</th>
              <td className="tabular py-1.5 pr-3 text-right text-ink-2">{formatCount(r.row_count)}</td>
              {result.measures.map((m) => (
                <td key={m.key} className="tabular py-1.5 pr-3 text-right text-ink">
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
  if (kind === 'pie') return <ShareChart rows={result.rows} measureKey={measure.key} measureLabel={measure.label} />
  return <BarComparison rows={result.rows} measureKey={measure.key} measureLabel={measure.label} />
}

interface DashboardProps {
  result: AnalysisResult
  chartKind: ChartKind
  measureKey: string
  onChartKind: (kind: ChartKind) => void
  onMeasureKey: (key: string) => void
}

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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span>
          <strong className="text-ink">{formatCount(result.rows_analyzed)}</strong> of {formatCount(result.row_count)} rows analysed
        </span>
        {result.grouping && (
          <span>
            {formatCount(result.grouping.total_groups)} group(s) by <strong className="text-ink">{result.grouping.column}</strong>
          </span>
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
          title={chartTitle(result, measureKey)}
          actions={
            <div role="group" aria-label="Chart type" className="flex rounded-lg border border-line-strong p-0.5">
              {kinds.map(({ kind, label, disabled }) => (
                <button
                  key={kind}
                  type="button"
                  disabled={disabled}
                  aria-pressed={chartKind === kind}
                  title={disabled ? (result.chart.pie_reason ?? undefined) : undefined}
                  onClick={() => onChartKind(kind)}
                  className={`min-h-8 rounded-md px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                    chartKind === kind ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-surface-2'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {result.measures.length > 1 && chartKind !== 'table' && (
            <div className="mb-3 max-w-xs">
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
          <div className="mt-3 grid gap-1 text-xs text-ink-muted">
            {result.chart.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
            {!result.chart.pie_allowed && result.chart.pie_reason && (
              <p>
                <button type="button" className="underline" aria-expanded={showWhy} onClick={() => setShowWhy((v) => !v)}>
                  Why is the donut chart unavailable?
                </button>
                {showWhy && <span className="block pt-1">{result.chart.pie_reason}</span>}
              </p>
            )}
          </div>
        </Card>
      )}

      {result.grouping && result.rows.length === 0 && <Alert kind="info" title="No groups to show">No rows match the selected filters.</Alert>}

      {result.grouping && chartKind !== 'table' && result.rows.length > 0 && (
        <Card title="Results table">
          <ResultsTable result={result} />
        </Card>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  FlaskConical,
  Gauge,
  Lightbulb,
  ListChecks,
  ScanSearch,
  Sigma,
  Target,
  TriangleAlert,
} from 'lucide-react'
import { BarComparison, TrendChart } from '../Charts'
import { Alert, Badge, Button, Card, Meter, Stat, selectClass, labelClass } from '../ui'
import { formatCount, formatNumber, TYPE_LABELS } from '../../lib/format'
import { formatP, KIND_LABEL, rowsOf, type AgentReport, type Evidence, type Finding } from '../../lib/agent'
import type { AnalysisSpec } from '../../lib/types'
import { BoxPlot, CorrelationHeatmap, Histogram, VarianceBars } from './AgentCharts'

/* eslint-disable @typescript-eslint/no-explicit-any -- evidence results are tool-specific JSON */
type R = Record<string, any>

export interface PageProps {
  report: AgentReport
  ev: Map<string, Evidence>
  onExplore: (spec: AnalysisSpec) => void
}

const CONFIDENCE_TONE = { high: 'good', medium: 'accent', low: 'warn' } as const

function Notes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null
  return (
    <ul className="mt-3 grid gap-1 text-xs text-ink-muted">
      {notes.map((n) => (
        <li key={n}>• {n}</li>
      ))}
    </ul>
  )
}

function KeyValues({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-ink-muted">{k}</dt>
          <dd className="tabular truncate font-semibold text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function EvidenceTag({ id }: { id: string }) {
  return (
    <span className="tabular rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2 ring-1 ring-inset ring-line" title="Evidence: a Python calculation recorded during the analysis">
      {id}
    </span>
  )
}

function trendOf(report: AgentReport, ev: Map<string, Evidence>): Evidence<R> | undefined {
  const chart = report.dashboard.charts.find((c) => c.type === 'trend')
  return chart ? (ev.get(chart.evidence_id) as Evidence<R>) : undefined
}

// ===================================================================== Page 1: Executive overview

export function OverviewPage({ report, ev, onExplore }: PageProps) {
  const trend = trendOf(report, ev)
  const segment = report.dashboard.charts.find((c) => c.type === 'bar')
  const seg = segment ? (ev.get(segment.evidence_id)?.result as R) : undefined
  const key = report.dashboard.key_findings.map((id) => report.findings.find((f) => f.id === id)).filter(Boolean) as Finding[]
  return (
    <div className="grid gap-5">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>
        {report.dashboard.kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-line bg-surface p-4 shadow-soft" title={k.definition}>
            <p className="text-xs font-medium text-ink-muted">{k.label}</p>
            <p className="tabular mt-1 text-2xl font-semibold tracking-tight text-ink">
              {formatNumber(k.value)}
              {k.unit === '%' ? '%' : ''}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-ink-muted">{k.definition}</p>
            <div className="mt-2">
              <EvidenceTag id={k.evidence_id} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {trend && (
          <Card title={`${trend.result.aggregation === 'mean' ? 'Average' : 'Total'} ${trend.result.measure ?? 'rows'} by ${trend.result.grain}`} subtitle={trend.result.partial_periods.length ? `Partial periods (excluded from comparisons): ${trend.result.partial_periods.join(', ')}` : 'All periods complete'} icon={Gauge}>
            <TrendChart rows={rowsOf(trend.result.periods.map((p: R) => ({ group: p.period, rows: p.rows, value: p.value })))} measureKey="v" measureLabel={String(trend.result.measure ?? 'Rows')} height={260} />
          </Card>
        )}
        {seg && (
          <Card title={`${seg.measure} by ${seg.dimension}`} subtitle={`Top segment share ${formatNumber((seg.top_share ?? 0) * 100)}% · top 3 share ${formatNumber((seg.top_3_share ?? 0) * 100)}%`} icon={Target}>
            <BarComparison rows={rowsOf(seg.segments.slice(0, 12).map((s: R) => ({ group: s.segment, rows: s.rows, value: s.total })))} measureKey="v" measureLabel={`Total ${seg.measure}`} />
          </Card>
        )}
      </div>
      <Card title="Key findings" subtitle="Validated findings only; every figure was computed in Python and cites its evidence." icon={Lightbulb}>
        {key.length === 0 && <p className="text-sm text-ink-muted">No finding met the evidence threshold.</p>}
        <ol className="grid gap-3">
          {key.map((f) => (
            <li key={f.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={CONFIDENCE_TONE[f.confidence]}>{f.confidence} confidence</Badge>
                <Badge>{KIND_LABEL[f.kind]}</Badge>
              </div>
              <p className="mt-2 text-sm font-semibold text-ink">{f.title}</p>
              <p className="mt-1 text-sm text-ink-2">
                <span className="font-medium text-ink">Action: </span>
                {f.recommended_action}
              </p>
              {f.spec && (
                <Button className="mt-2" size="sm" variant="ghost" icon={ArrowUpRight} onClick={() => onExplore(f.spec as AnalysisSpec)}>
                  Explore in Analyse
                </Button>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  )
}

// ===================================================================== Page 2: Data quality

export function QualityPage({ report, ev }: PageProps) {
  const du = report.data_understanding
  const ov = ev.get(du.overview_evidence)?.result as R | undefined
  return (
    <div className="grid gap-5">
      {ov && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Rows" value={formatCount(ov.rows)} icon={ListChecks} />
          <Stat label="Columns" value={formatCount(ov.columns)} icon={ClipboardList} tone="neutral" />
          <Stat label="Exact duplicate rows" value={formatCount(ov.exact_duplicate_rows)} icon={TriangleAlert} tone={ov.exact_duplicate_rows ? 'warn' : 'good'} />
          <Stat label="Missing cells" value={`${formatNumber(ov.missing_cell_pct)}%`} hint={`${formatCount(ov.missing_cells)} cells`} icon={CircleHelp} tone={ov.missing_cells ? 'warn' : 'good'} />
        </div>
      )}
      <Card title="Grain" subtitle={du.grain_basis} icon={ScanSearch}>
        <p className="text-sm font-semibold text-ink">{du.grain}</p>
      </Card>
      <Card title="Quality issues" subtitle="Separated into confirmed data-quality issues and items that need investigation with the data owner." icon={TriangleAlert}>
        {du.quality_issues.length === 0 && <p className="text-sm text-ink-muted">No issues detected.</p>}
        <ul className="grid gap-2">
          {du.quality_issues.map((i) => (
            <li key={i.issue} className="flex flex-wrap items-start gap-2 rounded-xl border border-line p-3 text-sm">
              <Badge tone={i.severity === 'warning' ? 'warn' : 'neutral'}>{i.severity}</Badge>
              <Badge tone={i.kind === 'needs_investigation' ? 'accent' : 'neutral'}>{i.kind === 'needs_investigation' ? 'Needs investigation' : 'Data quality'}</Badge>
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-ink">{i.issue}. </span>
                <span className="text-ink-2">{i.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Completeness by column" subtitle="Share of rows with a value." icon={CircleHelp}>
          <ul className="grid gap-2">
            {du.data_dictionary.map((d) => (
              <li key={d.column} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink" title={d.column}>
                  {d.column}
                </span>
                <Meter value={Math.round((100 - (d.missing_pct ?? 0)) * 10) / 10} label={`${d.column} completeness`} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Validation" subtitle={`Holm-Bonferroni correction across ${report.validation.multiple_testing.tests.length} test(s); totals recomputed independently.`} icon={CircleCheck}>
          <table className="tabular w-full text-sm" aria-label="Reconciliation of totals">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="pb-2 font-medium">Measure</th>
                <th className="pb-2 text-right font-medium">Engine</th>
                <th className="pb-2 text-right font-medium">Independent</th>
                <th className="pb-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.validation.reconciliation.map((r) => (
                <tr key={r.evidence_id} className="border-t border-line">
                  <td className="py-2 text-ink">
                    {r.aggregation === 'mean' ? 'Average' : 'Total'} {r.measure}
                  </td>
                  <td className="py-2 text-right">{formatNumber(r.engine_value)}</td>
                  <td className="py-2 text-right">{formatNumber(r.independent_value)}</td>
                  <td className="py-2 text-right">{r.reconciled ? <Badge tone="good">Reconciled</Badge> : <Badge tone="bad">Mismatch</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="Cleaning log (phase 3)" subtitle="Non-destructive: the uploaded file is never modified. 'Not applied' means flagged for a decision, not changed." icon={ClipboardList}>
        <ul className="grid gap-2">
          {report.preparation.cleaning_log.map((c) => (
            <li key={c.step} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{c.step}</span>
                <Badge tone={c.applied ? 'good' : 'accent'}>{c.applied ? 'Applied' : 'Not applied'}</Badge>
              </div>
              <p className="mt-1 text-ink-2">{c.decision}</p>
              <p className="mt-0.5 text-xs text-ink-muted">Why: {c.reason}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

// ===================================================================== Page 3: Univariate

export function UnivariatePage({ report, ev }: PageProps) {
  const options = report.data_understanding.data_dictionary.filter((d) => d.evidence_id)
  const [column, setColumn] = useState(options[0]?.column ?? '')
  const entry = options.find((o) => o.column === column)
  const r = entry?.evidence_id ? (ev.get(entry.evidence_id)?.result as R) : undefined
  return (
    <Card
      title="Univariate analysis"
      subtitle="One variable at a time: distribution, centre, spread and unusual values."
      icon={Sigma}
      actions={
        <div className="w-60">
          <label htmlFor="uni-column" className={labelClass}>
            Variable
          </label>
          <select id="uni-column" className={selectClass} value={column} onChange={(e) => setColumn(e.target.value)}>
            {options.map((o) => (
              <option key={o.column} value={o.column}>
                {o.column} ({TYPE_LABELS[o.type] ?? o.type})
              </option>
            ))}
          </select>
        </div>
      }
    >
      {!r && <p className="text-sm text-ink-muted">No profile for this column.</p>}
      {r && r.type === 'number' && (
        <div className="grid gap-5">
          <KeyValues
            items={[
              ['Count', formatCount(r.n)],
              ['Missing', formatCount(r.missing)],
              ['Mean', formatNumber(r.mean)],
              ['Median', formatNumber(r.median)],
              ['Std deviation', formatNumber(r.std)],
              ['Min / Max', `${formatNumber(r.min)} / ${formatNumber(r.max)}`],
              ['Q1 / Q3', `${formatNumber(r.q1)} / ${formatNumber(r.q3)}`],
              ['IQR', formatNumber(r.iqr)],
              ['Skewness', formatNumber(r.skewness)],
              ['Excess kurtosis', formatNumber(r.excess_kurtosis)],
              ['Outliers (1.5×IQR)', `${formatCount(r.outlier_count ?? 0)} (${formatNumber((r.outlier_share ?? 0) * 100)}%)`],
              ['Negative values', formatCount(r.negative_count ?? 0)],
            ]}
          />
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Histogram bins={r.histogram ?? []} label={column} />
            <div className="grid content-center">
              <BoxPlot stats={r as never} label={column} />
            </div>
          </div>
        </div>
      )}
      {r && (r.type === 'category' || r.type === 'boolean') && (
        <div className="grid gap-4">
          <KeyValues
            items={[
              ['Values', formatCount(r.n)],
              ['Missing', formatCount(r.missing)],
              ['Categories', formatCount(r.unique)],
              ['Most common', `${r.mode} (${formatNumber(r.mode_share * 100)}%)`],
              ['Imbalance (largest ÷ smallest)', formatNumber(r.imbalance_ratio)],
              ['Rare categories (< 5 rows)', formatCount(r.rare_categories)],
            ]}
          />
          <BarComparison rows={rowsOf(r.frequencies.map((f: R) => ({ group: f.value, rows: f.count, value: f.count })))} measureKey="v" measureLabel="Rows" />
        </div>
      )}
      {r && r.type === 'date' && (
        <div className="grid gap-4">
          <KeyValues items={[['From', r.min], ['To', r.max], ['Span (days)', formatCount(r.span_days)], ['Distinct days', formatCount(r.distinct_days)], ['Missing', formatCount(r.missing)], ['Invalid', formatCount(r.invalid)]]} />
          <BarComparison rows={rowsOf(Object.entries(r.rows_by_weekday as Record<string, number>).map(([d, n]) => ({ group: d, rows: n, value: n })))} measureKey="v" measureLabel="Rows" />
        </div>
      )}
      {r && !['number', 'category', 'boolean', 'date'].includes(r.type) && (
        <KeyValues items={[['Values', formatCount(r.n ?? 0)], ['Unique', formatCount(r.unique ?? 0)], ['Repeated values', formatCount(r.duplicated_values ?? 0)]]} />
      )}
      <Notes notes={r?.notes} />
    </Card>
  )
}

// ===================================================================== Page 4: Bivariate

const BIVARIATE = ['trend', 'compare_groups', 'correlate', 'crosstab', 'segment_contribution']

function bivariateLabel(e: Evidence<R>): string {
  const a = e.args as R
  switch (e.tool) {
    case 'trend':
      return `${a.measure ?? 'rows'} over time (${a.grain ?? 'month'})`
    case 'compare_groups':
      return `${a.measure} by ${a.group_by} (group test)`
    case 'correlate':
      return `${a.x} vs ${a.y} (correlation)`
    case 'crosstab':
      return `${a.row} × ${a.column} (chi-square)`
    default:
      return `${a.measure} share by ${a.dimension}`
  }
}

export function BivariatePage({ report, onExplore }: PageProps) {
  const items = report.evidence.filter((e) => e.phase >= 4 && BIVARIATE.includes(e.tool)) as Evidence<R>[]
  const [id, setId] = useState(items[0]?.id ?? '')
  const e = items.find((i) => i.id === id)
  const tests = report.validation.multiple_testing.tests
  const adj = tests.find((t) => t.evidence_id === id)?.adjusted_p_value
  const r = e?.result
  return (
    <Card
      title="Bivariate analysis"
      subtitle="Relationships the analyst investigated, with the method chosen for each pair of variable types."
      icon={FlaskConical}
      actions={
        <div className="w-72">
          <label htmlFor="bi-analysis" className={labelClass}>
            Analysis
          </label>
          <select id="bi-analysis" className={selectClass} value={id} onChange={(ev2) => setId(ev2.target.value)}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id}: {bivariateLabel(i)}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {!e && <p className="text-sm text-ink-muted">No bivariate analysis was run.</p>}
      {e && r && (
        <div className="grid gap-5">
          {e.tool === 'trend' && (
            <>
              <TrendChart rows={rowsOf(r.periods.map((p: R) => ({ group: p.period, rows: p.rows, value: p.value })))} measureKey="v" measureLabel={String(r.measure ?? 'Rows')} />
              <KeyValues
                items={[
                  ['Complete periods', formatCount(r.trend?.n_periods ?? 0)],
                  ['Slope per period', formatNumber(r.trend?.slope_per_period)],
                  ['Trend p (adjusted)', formatP(adj ?? r.trend?.p_value)],
                  ['Latest change', r.period_over_period ? `${formatNumber(r.period_over_period.percent_change)}%` : 'n/a'],
                  ['Missing periods', formatCount(r.missing_periods.length)],
                  ['Partial periods', r.partial_periods.join(', ') || 'none'],
                ]}
              />
            </>
          )}
          {e.tool === 'compare_groups' && (
            <>
              <BarComparison rows={rowsOf(r.groups.filter((g: R) => g.mean !== null).map((g: R) => ({ group: g.group, rows: g.n, value: g.mean })))} measureKey="v" measureLabel={`Average ${r.measure}`} />
              {r.test && (
                <KeyValues
                  items={[
                    ['Test', String(r.test.name).replace(/_/g, ' ')],
                    ['Statistic', formatNumber(r.test.statistic)],
                    ['p (adjusted)', formatP(adj ?? r.test.p_value)],
                    [String(r.test.effect_size.name).replace(/_/g, ' '), formatNumber(r.test.effect_size.value)],
                    [String(r.test.robust_check.name).replace(/_/g, ' ') + ' p', formatP(r.test.robust_check.p_value)],
                    ...(r.test.ci95_low !== undefined ? ([['95% CI of difference', `${formatNumber(r.test.ci95_low)} to ${formatNumber(r.test.ci95_high)}`]] as [string, string][]) : []),
                  ]}
                />
              )}
            </>
          )}
          {e.tool === 'correlate' && (
            <KeyValues
              items={[
                ['Pairs', formatCount(r.n)],
                ['Pearson r', formatNumber(r.pearson_r)],
                ['Spearman ρ', formatNumber(r.spearman_rho)],
                ['R²', formatNumber(r.r_squared)],
                ['p (Spearman, adjusted)', formatP(adj ?? r.spearman_p)],
              ]}
            />
          )}
          {e.tool === 'crosstab' && r.test && (
            <>
              <div className="overflow-x-auto">
                <table aria-label={`Row proportions of ${r.row} by ${r.column}`} className="tabular w-full text-xs">
                  <thead>
                    <tr>
                      <th className="p-1.5 text-left text-ink-muted">{r.row}</th>
                      {r.columns.map((c: string) => (
                        <th key={c} className="p-1.5 text-right font-medium text-ink-muted">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row: string, i: number) => (
                      <tr key={row} className="border-t border-line">
                        <th scope="row" className="p-1.5 text-left font-medium text-ink">
                          {row}
                        </th>
                        {r.row_proportions[i]?.map((p: number | null, j: number) => (
                          <td key={j} className="p-1.5 text-right" style={{ background: `color-mix(in oklab, var(--series-1) ${Math.round((p ?? 0) * 60)}%, transparent)` }}>
                            {formatNumber((p ?? 0) * 100)}%
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <KeyValues items={[['Chi-square', formatNumber(r.test.statistic)], ['Degrees of freedom', formatCount(r.test.df)], ['p (adjusted)', formatP(adj ?? r.test.p_value)], ["Cramér's V", formatNumber(r.test.effect_size.value)]]} />
            </>
          )}
          {e.tool === 'segment_contribution' && (
            <>
              <BarComparison rows={rowsOf(r.segments.slice(0, 15).map((s: R) => ({ group: s.segment, rows: s.rows, value: s.total })))} measureKey="v" measureLabel={`Total ${r.measure}`} />
              <KeyValues items={[['Segments', formatCount(r.segment_count)], ['Top share', `${formatNumber((r.top_share ?? 0) * 100)}%`], ['Top 3 share', `${formatNumber((r.top_3_share ?? 0) * 100)}%`], ['HHI', formatNumber(r.hhi)]]} />
            </>
          )}
          <Notes notes={r.notes} />
          {(e.tool === 'compare_groups' || e.tool === 'segment_contribution' || e.tool === 'trend') && (
            <div>
              <Button size="sm" variant="ghost" icon={ArrowUpRight} onClick={() => onExplore(specFor(e))}>
                Explore in Analyse
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function specFor(e: Evidence<R>): AnalysisSpec {
  const a = e.args as R
  const base = { filters: [], remove_duplicates: false, merge_label_variants: false, time_grain: 'month' as const }
  if (e.tool === 'trend') return { ...base, measures: [a.measure ? { column: a.measure, aggregation: a.aggregation ?? 'sum' } : { column: null, aggregation: 'count' }], group_by: a.date_column, time_grain: a.grain ?? 'month' }
  if (e.tool === 'compare_groups') return { ...base, measures: [{ column: a.measure, aggregation: 'mean' }], group_by: a.group_by }
  return { ...base, measures: [{ column: a.measure, aggregation: 'sum' }], group_by: a.dimension }
}

// ===================================================================== Page 5: Multivariate

export function MultivariatePage({ report }: PageProps) {
  const latest = (tool: string) => [...report.evidence].reverse().find((e) => e.tool === tool && e.phase >= 4) as Evidence<R> | undefined
  const matrix = latest('correlation_matrix')
  const pca = latest('pca')
  const twoWay = latest('two_way_breakdown')
  const regression = latest('regression')
  const [method, setMethod] = useState<'spearman' | 'pearson'>('spearman')
  if (!matrix && !pca && !twoWay && !regression) {
    return (
      <Card title="Multivariate analysis" icon={Sigma}>
        <p className="text-sm text-ink-muted">The analyst did not find enough numeric variables to justify a multivariate analysis for this file.</p>
      </Card>
    )
  }
  return (
    <div className="grid gap-5">
      {matrix && (
        <Card
          title="Correlation heatmap"
          subtitle="Identifiers excluded. Blue = move together, orange = move in opposite directions."
          icon={Sigma}
          actions={
            <div role="group" aria-label="Correlation method" className="flex rounded-xl bg-surface-2 p-1 ring-1 ring-inset ring-line">
              {(['spearman', 'pearson'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${method === m ? 'bg-surface text-ink shadow-soft ring-1 ring-line' : 'text-ink-muted hover:text-ink'}`}>
                  {m === 'spearman' ? 'Spearman' : 'Pearson'}
                </button>
              ))}
            </div>
          }
        >
          <CorrelationHeatmap columns={matrix.result.columns} matrix={matrix.result[method]} label={`${method === 'spearman' ? 'Spearman' : 'Pearson'} correlation matrix`} />
          <Notes notes={matrix.result.notes} />
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {pca?.result.explained_variance_ratio && (
          <Card title="Principal components" subtitle={`${formatCount(pca.result.n)} complete rows; standardised variables.`} icon={Sigma}>
            <VarianceBars ratios={pca.result.explained_variance_ratio} />
            {pca.result.components?.[0] && (
              <p className="mt-3 text-xs text-ink-muted">
                PC1 is driven most by: {pca.result.components[0].loadings.slice(0, 3).map((l: R) => `${l.variable} (${formatNumber(l.loading)})`).join(', ')}.
              </p>
            )}
            <Notes notes={pca.result.notes} />
          </Card>
        )}
        {regression?.result.coefficients && (
          <Card title={`Regression of ${regression.result.target}`} subtitle={`R² ${formatNumber(regression.result.r_squared)} · adjusted ${formatNumber(regression.result.adj_r_squared)} · n ${formatCount(regression.result.n)}`} icon={Sigma}>
            <table className="tabular w-full text-sm" aria-label="Regression coefficients">
              <tbody>
                {regression.result.coefficients.map((c: R) => (
                  <tr key={c.term} className="border-t border-line">
                    <td className="py-1.5 text-ink">{c.term}</td>
                    <td className="py-1.5 text-right">{formatNumber(c.estimate)}</td>
                    <td className="py-1.5 text-right text-ink-muted">p {formatP(c.p_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Notes notes={regression.result.notes} />
          </Card>
        )}
      </div>
      {twoWay && (
        <Card title={`${twoWay.result.aggregation === 'mean' ? 'Average' : 'Total'} ${twoWay.result.measure} by ${String(twoWay.args.dim_a)} × ${String(twoWay.args.dim_b)}`} subtitle="Grouped aggregation by two dimensions." icon={Sigma}>
          <div className="overflow-x-auto">
            <table aria-label="Two-way breakdown" className="tabular w-full text-xs">
              <thead>
                <tr>
                  <th />
                  {twoWay.result.columns.map((c: string) => (
                    <th key={c} className="p-1.5 text-right font-medium text-ink-muted">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {twoWay.result.rows.map((row: string, i: number) => (
                  <tr key={row} className="border-t border-line">
                    <th scope="row" className="p-1.5 text-left font-medium text-ink">
                      {row}
                    </th>
                    {twoWay.result.values[i].map((v: number | null, j: number) => (
                      <td key={j} className="p-1.5 text-right">
                        {formatNumber(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ===================================================================== Page 6: Business insights

const KINDS: { value: 'all' | Finding['kind']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'observed_fact', label: 'Facts' },
  { value: 'statistical_association', label: 'Associations' },
  { value: 'data_quality', label: 'Data quality' },
]

export function InsightsPage({ report, onExplore }: PageProps) {
  const [kind, setKind] = useState<'all' | Finding['kind']>('all')
  const shown = useMemo(() => report.findings.filter((f) => kind === 'all' || f.kind === kind), [report.findings, kind])
  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Filter findings" className="flex w-fit flex-wrap rounded-xl bg-surface-2 p-1 ring-1 ring-inset ring-line">
        {KINDS.map((k) => (
          <button key={k.value} type="button" aria-pressed={kind === k.value} onClick={() => setKind(k.value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${kind === k.value ? 'bg-surface text-ink shadow-soft ring-1 ring-line' : 'text-ink-muted hover:text-ink'}`}>
            {k.label} ({k.value === 'all' ? report.findings.length : report.findings.filter((f) => f.kind === k.value).length})
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="text-sm text-ink-muted">No findings of this kind.</p>}
      {shown.map((f) => (
        <article key={f.id} aria-label={`Insight ${f.id}`} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-xs font-semibold text-ink-muted">{f.id}</span>
            <Badge tone={CONFIDENCE_TONE[f.confidence]}>{f.confidence} confidence</Badge>
            <Badge>{KIND_LABEL[f.kind]}</Badge>
            {f.evidence_ids.map((id) => (
              <EvidenceTag key={id} id={id} />
            ))}
          </div>
          <h3 className="mt-2 text-base font-semibold tracking-tight text-ink">{f.title}</h3>
          {!f.grounded && (
            <div className="mt-3">
              <Alert kind="warning" title="Contains figures that could not be matched to a calculation">
                {f.unverified_numbers.join(', ')}. Treat this finding as unverified.
              </Alert>
            </div>
          )}
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            {(
              [
                ['What happened?', f.what_happened],
                ['Where?', f.where],
                ['How large?', f.magnitude || '—'],
                ['Compared with', [f.baseline, f.comparison].filter(Boolean).join(' → ') || '—'],
                ['What might explain it? (not verified)', f.possible_explanations.length ? f.possible_explanations.join('; ') : '—'],
                ['What action to consider?', f.recommended_action],
                ['How to measure success?', f.success_metric || '—'],
                ['Limitations', f.limitations || '—'],
              ] as [string, string][]
            ).map(([q, a]) => (
              <div key={q}>
                <dt className="text-xs font-semibold text-ink-muted">{q}</dt>
                <dd className="mt-0.5 text-ink-2">{a}</dd>
              </div>
            ))}
          </dl>
          {f.spec && (
            <Button className="mt-3" size="sm" variant="soft" icon={ArrowUpRight} onClick={() => onExplore(f.spec as AnalysisSpec)}>
              Explore in Analyse
            </Button>
          )}
        </article>
      ))}
    </div>
  )
}

// ===================================================================== Plan & method (phases 0-3)

export function PlanPage({ report }: PageProps) {
  const c = report.charter
  return (
    <div className="grid gap-5">
      <Card title="Project charter (phase 0)" subtitle={c.provided_by_user ? 'Based on the business context you provided.' : 'No business context was provided: see the assumptions.'} icon={Target}>
        <KeyValues items={[['Business context', c.business_context], ['Audience', c.stakeholders]]} />
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          {(
            [
              ['Objectives', c.objectives],
              ['Decisions supported', c.decisions_supported],
              ['In scope', c.in_scope],
              ['Out of scope', c.out_of_scope],
              ['Success criteria', c.success_criteria],
              ['Preliminary KPIs', c.preliminary_kpis],
            ] as [string, string[]][]
          ).map(([t, list]) => (
            <div key={t}>
              <p className="text-xs font-semibold text-ink-muted">{t}</p>
              <ul className="mt-1 grid gap-0.5 text-ink-2">
                {(list ?? []).map((x) => (
                  <li key={x}>• {x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {c.assumptions.length > 0 && (
          <div className="mt-4">
            <Alert kind="info" title="Assumptions to confirm">
              <ul className="grid gap-0.5">
                {c.assumptions.map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
      </Card>
      <Card title="Question register (phase 2)" icon={ListChecks}>
        <div className="overflow-x-auto">
          <table aria-label="Question register" className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="p-2 font-medium">ID</th>
                <th className="p-2 font-medium">Question</th>
                <th className="p-2 font-medium">Method</th>
                <th className="p-2 font-medium">Priority</th>
                <th className="p-2 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {report.questions.map((q) => (
                <tr key={q.id} className="border-t border-line align-top">
                  <td className="tabular p-2 font-semibold text-ink-muted">{q.id}</td>
                  <td className="p-2 text-ink">
                    {q.question}
                    <p className="mt-0.5 text-xs text-ink-muted">{q.rationale}</p>
                  </td>
                  <td className="p-2 text-xs text-ink-2">{q.method}</td>
                  <td className="p-2">
                    <Badge tone={q.priority === 'high' ? 'accent' : 'neutral'}>{q.priority}</Badge>
                  </td>
                  <td className="p-2">
                    <span className="flex flex-wrap gap-1">{q.evidence_ids.length ? q.evidence_ids.map((id) => <EvidenceTag key={id} id={id} />) : <span className="text-xs text-ink-muted">none</span>}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Hypothesis register" subtitle="Hypotheses are not conclusions; results use Holm-adjusted p-values (α = 0.05) and effect sizes." icon={FlaskConical}>
        <ul className="grid gap-2">
          {report.hypotheses.map((h) => (
            <li key={h.id} className="flex flex-wrap items-start gap-2 rounded-xl border border-line p-3 text-sm">
              <span className="tabular font-semibold text-ink-muted">{h.id}</span>
              <span className="min-w-0 flex-1 text-ink">{h.statement}</span>
              <Badge tone={h.result === 'supported' ? 'good' : h.result === 'not_supported' ? 'neutral' : 'warn'}>{h.result.replace('_', ' ')}</Badge>
              {h.adjusted_p_value !== undefined && h.adjusted_p_value !== null && <span className="tabular text-xs text-ink-muted">adj. p {formatP(h.adjusted_p_value)}</span>}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="KPI definitions (phase 3)" subtitle="One authoritative definition per metric; the dashboard uses only these." icon={ClipboardList}>
        <ul className="grid gap-2 text-sm">
          {report.preparation.metric_definitions.map((m) => (
            <li key={m.name}>
              <span className="font-semibold text-ink">{m.name}: </span>
              <span className="text-ink-2">{m.formula}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Limitations" icon={TriangleAlert}>
          <ul className="grid gap-1 text-sm text-ink-2">
            {report.limitations.map((l) => (
              <li key={l}>• {l}</li>
            ))}
          </ul>
        </Card>
        <Card title="Outstanding questions" icon={CircleHelp}>
          <ul className="grid gap-1 text-sm text-ink-2">
            {report.outstanding_questions.map((q) => (
              <li key={q}>• {q}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

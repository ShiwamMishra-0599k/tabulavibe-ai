import { Columns3, Copy, Rows3, ShieldCheck, Stethoscope, TableProperties, TriangleAlert, CircleHelp } from 'lucide-react'
import type { ColumnProfile, Profile } from '../lib/types'
import { formatCount, formatDate, formatNumber, formatPercent, TYPE_LABELS } from '../lib/format'
import { TYPE_ICONS } from '../lib/icons'
import { Alert, Badge, Card, Meter, ProgressRing, Stat } from './ui'

function ColumnDetail({ column }: { column: ColumnProfile }) {
  if (column.numeric_stats) {
    const s = column.numeric_stats
    return (
      <span className="tabular">
        min {formatNumber(s.min)} · mean {formatNumber(s.mean)} · median {formatNumber(s.median)} · max {formatNumber(s.max)}
      </span>
    )
  }
  if (column.date_range) {
    return (
      <span>
        {formatDate(column.date_range.min)} – {formatDate(column.date_range.max)}
      </span>
    )
  }
  if (column.top_values?.length) {
    return (
      <span>
        {column.top_values
          .slice(0, 3)
          .map((v) => `${v.value} (${formatCount(v.count)})`)
          .join(', ')}
      </span>
    )
  }
  return <span className="text-ink-muted">—</span>
}

function healthVerdict(pct: number): { label: string; tone: 'good' | 'accent' | 'warn' } {
  if (pct >= 95) return { label: 'Ready to analyse', tone: 'good' }
  if (pct >= 80) return { label: 'Usable, with a few gaps', tone: 'accent' }
  return { label: 'Needs attention', tone: 'warn' }
}

export function QualityReport({ profile }: { profile: Profile }) {
  const { dataset, columns, issues, notes } = profile
  const warnings = issues.filter((i) => i.severity === 'warning')
  const infos = issues.filter((i) => i.severity === 'info')
  const verdict = healthVerdict(dataset.valid_cell_pct)
  return (
    // minmax(0,1fr): wide tables scroll inside their cards instead of widening the page on phones.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section className="animate-rise gradient-border flex items-center gap-5 rounded-2xl p-5 shadow-card" aria-labelledby="health-title">
          <ProgressRing value={dataset.valid_cell_pct} label="Data health" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">
              <Stethoscope aria-hidden className="size-3.5" />
              <span id="health-title">Data health</span>
            </p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-ink">{verdict.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Share of cells that are present and valid for their column type, across all {formatCount(dataset.row_count)} rows and{' '}
              {formatCount(dataset.column_count)} columns.
            </p>
          </div>
        </section>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat icon={Rows3} label="Rows" value={formatCount(dataset.row_count)} />
          <Stat icon={Columns3} label="Columns" value={formatCount(dataset.column_count)} />
          <Stat
            icon={CircleHelp}
            tone={dataset.missing_cell_count ? 'warn' : 'good'}
            label="Missing cells"
            value={formatCount(dataset.missing_cell_count)}
            hint={`${formatPercent(dataset.missing_cell_pct)} of all cells`}
          />
          <Stat
            icon={Copy}
            tone={dataset.duplicate_row_count ? 'warn' : 'good'}
            label="Duplicate rows"
            value={formatCount(dataset.duplicate_row_count)}
            hint="Exact copies of an earlier row"
          />
        </div>
      </div>

      <Card icon={TriangleAlert} title="Data quality findings" subtitle={`${warnings.length} to review · ${infos.length + notes.length} for information`}>
        <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-good-soft p-3 text-sm text-ink-2">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-good" />
          <p>
            These are detected issues. Nothing has been changed in your data: missing and invalid values are excluded from calculations, and
            duplicates are kept unless you choose to remove them in the analysis.
          </p>
        </div>
        <div className="grid gap-2">
          {warnings.length === 0 && infos.length === 0 && <Alert kind="success" title="No data-quality issues were detected." />}
          {warnings.map((issue, i) => (
            <Alert key={`w${i}`} kind="warning">
              {issue.message}
            </Alert>
          ))}
          {infos.map((issue, i) => (
            <Alert key={`i${i}`} kind="info">
              {issue.message}
            </Alert>
          ))}
          {notes.map((note, i) => (
            <Alert key={`n${i}`} kind="info">
              {note}
            </Alert>
          ))}
        </div>
      </Card>

      <Card icon={TableProperties} title="Columns" subtitle="Detected type, completeness and a quick summary of each column">
        <div className="overflow-x-auto rounded-xl border border-line" tabIndex={0} aria-label="Column profile table">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">Inferred type and quality of each column</caption>
            <thead className="bg-surface-2">
              <tr className="text-xs text-ink-muted">
                <th scope="col" className="px-3 py-2.5 font-medium">Column</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Type</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Valid</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Missing</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Invalid</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Distinct</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.name} className="border-t border-line align-top transition-colors hover:bg-surface-2/60">
                  <th scope="row" className="px-3 py-2.5 font-semibold text-ink">
                    {c.name}
                    {c.role === 'identifier' && (
                      <span className="ml-2">
                        <Badge>ID</Badge>
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-2.5">
                    <Badge icon={TYPE_ICONS[c.inferred_type]} tone={c.inferred_type === 'number' ? 'accent' : 'neutral'}>
                      {TYPE_LABELS[c.inferred_type]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Meter value={c.valid_pct} label={`${c.name} valid values`} />
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {formatCount(c.missing_count)}
                    <span className="block text-xs text-ink-muted">{formatPercent(c.missing_pct)}</span>
                  </td>
                  <td className={`tabular px-3 py-2.5 text-right ${c.invalid_count ? 'font-semibold text-warn' : ''}`}>{formatCount(c.invalid_count)}</td>
                  <td className="tabular px-3 py-2.5 text-right">{formatCount(c.unique_count)}</td>
                  <td className="px-3 py-2.5 text-xs text-ink-2">
                    <ColumnDetail column={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

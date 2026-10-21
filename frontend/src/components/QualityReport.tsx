import type { ColumnProfile, Profile } from '../lib/types'
import { formatCount, formatDate, formatNumber, formatPercent, TYPE_LABELS } from '../lib/format'
import { Alert, Badge, Card, Stat } from './ui'

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

export function QualityReport({ profile }: { profile: Profile }) {
  const { dataset, columns, issues, notes } = profile
  const warnings = issues.filter((i) => i.severity === 'warning')
  const infos = issues.filter((i) => i.severity === 'info')
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Rows" value={formatCount(dataset.row_count)} />
        <Stat label="Columns" value={formatCount(dataset.column_count)} />
        <Stat
          label="Missing cells"
          value={formatCount(dataset.missing_cell_count)}
          hint={`${formatPercent(dataset.missing_cell_pct)} of all cells`}
        />
        <Stat label="Duplicate rows" value={formatCount(dataset.duplicate_row_count)} hint="Exact copies of an earlier row" />
      </div>

      <Card title="Data quality findings">
        <p className="mb-3 text-sm text-ink-2">
          These are detected issues. Nothing has been changed in your data: missing and invalid values are excluded from calculations, and
          duplicates are kept unless you choose to remove them in the analysis.
        </p>
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

      <Card title="Columns">
        <div className="overflow-x-auto" tabIndex={0} aria-label="Column profile table">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <caption className="sr-only">Inferred type and quality of each column</caption>
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Column</th>
                <th scope="col" className="py-2 pr-3 font-medium">Type</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Missing</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Invalid</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Distinct</th>
                <th scope="col" className="py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.name} className="border-b border-line align-top">
                  <th scope="row" className="py-2 pr-3 font-medium text-ink">
                    {c.name}
                    {c.role === 'identifier' && (
                      <span className="ml-2">
                        <Badge>ID</Badge>
                      </span>
                    )}
                  </th>
                  <td className="py-2 pr-3">
                    <Badge tone={c.inferred_type === 'number' ? 'accent' : 'neutral'}>{TYPE_LABELS[c.inferred_type]}</Badge>
                  </td>
                  <td className="tabular py-2 pr-3 text-right">
                    {formatCount(c.missing_count)}
                    <span className="block text-xs text-ink-muted">{formatPercent(c.missing_pct)}</span>
                  </td>
                  <td className={`tabular py-2 pr-3 text-right ${c.invalid_count ? 'font-semibold text-warn' : ''}`}>
                    {formatCount(c.invalid_count)}
                  </td>
                  <td className="tabular py-2 pr-3 text-right">{formatCount(c.unique_count)}</td>
                  <td className="py-2 text-xs text-ink-2">
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

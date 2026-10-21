import type { Profile } from '../lib/types'
import { formatCount, TYPE_LABELS } from '../lib/format'
import { Badge, Card } from './ui'

export function DataPreview({ profile }: { profile: Profile }) {
  const { preview, columns } = profile
  const types = new Map(columns.map((c) => [c.name, c.inferred_type]))
  return (
    <Card
      title="Data preview"
      actions={
        <span className="text-xs text-ink-muted">
          First {formatCount(preview.rows.length)} of {formatCount(preview.total_rows)} rows
        </span>
      }
    >
      <div className="max-h-[480px] overflow-auto rounded-lg border border-line" tabIndex={0} aria-label="Data preview table">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">First rows of the uploaded data</caption>
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 text-xs font-medium text-ink-muted">
                #
              </th>
              {preview.columns.map((name) => (
                <th key={name} scope="col" className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                  <span className="block">{name}</span>
                  <Badge>{TYPE_LABELS[types.get(name) ?? 'text']}</Badge>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i} className="border-t border-line">
                <td className="tabular px-3 py-1.5 text-xs text-ink-muted">{i + 1}</td>
                {row.map((cell, j) => (
                  <td key={j} className="max-w-64 truncate whitespace-nowrap px-3 py-1.5 text-ink-2" title={cell}>
                    {cell === '' ? <span className="text-ink-muted italic">empty</span> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

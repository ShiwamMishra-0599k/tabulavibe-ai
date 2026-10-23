import { Eye } from 'lucide-react'
import type { InferredType, Profile } from '../lib/types'
import { formatCount, TYPE_LABELS } from '../lib/format'
import { TYPE_ICONS } from '../lib/icons'
import { Badge, Card } from './ui'

export function DataPreview({ profile }: { profile: Profile }) {
  const { preview, columns } = profile
  const types = new Map(columns.map((c) => [c.name, c.inferred_type]))
  const counts = new Map<InferredType, number>()
  for (const c of columns) counts.set(c.inferred_type, (counts.get(c.inferred_type) ?? 0) + 1)
  return (
    <Card
      className="min-w-0"
      icon={Eye}
      title="Data preview"
      subtitle="Column types were detected automatically. Check they look right before analysing."
      actions={
        <Badge tone="accent">
          First {formatCount(preview.rows.length)} of {formatCount(preview.total_rows)} rows
        </Badge>
      }
    >
      <ul className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Detected column types">
        {[...counts.entries()].map(([type, n]) => (
          <li key={type}>
            <Badge icon={TYPE_ICONS[type]} tone={type === 'number' ? 'accent' : 'neutral'}>
              {n} {TYPE_LABELS[type]}
            </Badge>
          </li>
        ))}
        <li className="text-xs text-ink-muted">
          · <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] italic">empty</span> marks a missing value
        </li>
      </ul>
      <div className="max-h-[520px] overflow-auto rounded-xl border border-line" tabIndex={0} aria-label="Data preview table">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">First rows of the uploaded data</caption>
          <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-xs font-medium text-ink-muted">
                #
              </th>
              {preview.columns.map((name) => {
                const type = types.get(name) ?? 'text'
                return (
                  <th key={name} scope="col" className="whitespace-nowrap px-3 py-2.5 font-semibold text-ink">
                    <span className="block">{name}</span>
                    <span className="mt-1 inline-block">
                      <Badge icon={TYPE_ICONS[type]} tone={type === 'number' ? 'accent' : 'neutral'}>
                        {TYPE_LABELS[type]}
                      </Badge>
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i} className="border-t border-line transition-colors hover:bg-accent-soft/40">
                <td className="tabular px-3 py-2 text-xs text-ink-muted">{i + 1}</td>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={`max-w-64 truncate whitespace-nowrap px-3 py-2 text-ink-2 ${types.get(preview.columns[j]) === 'number' ? 'tabular text-right' : ''}`}
                    title={cell}
                  >
                    {cell === '' ? <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-muted italic">empty</span> : cell}
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

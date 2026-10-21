import { useId } from 'react'
import type { AnalysisSpec, FilterSpec, Profile, TimeGrain } from '../lib/types'
import { AGG_LABELS } from '../lib/format'
import { aggregationsFor, groupableColumns, MAX_MEASURES, ROW_COUNT, validateSpec } from '../lib/spec'
import { Alert, Button, Card, labelClass, selectClass } from './ui'

interface Props {
  profile: Profile
  spec: AnalysisSpec
  onChange: (spec: AnalysisSpec) => void
  onRun: () => void
  busy: boolean
}

const GRAINS: TimeGrain[] = ['day', 'week', 'month', 'quarter', 'year']

export function AnalysisBuilder({ profile, spec, onChange, onRun, busy }: Props) {
  const id = useId()
  const byName = new Map(profile.columns.map((c) => [c.name, c]))
  const measureColumns = profile.columns.filter((c) => c.inferred_type !== 'empty')
  const groupable = groupableColumns(profile)
  const filterable = profile.columns.filter((c) => profile.filter_options[c.name] || c.inferred_type === 'date')
  const errors = validateSpec(spec, profile)
  const groupType = spec.group_by ? byName.get(spec.group_by)?.inferred_type : null
  const variantColumns = profile.columns.filter((c) => c.inferred_type === 'category' && c.notes.some((n) => n.includes('letter case'))).map((c) => c.name)

  const update = (patch: Partial<AnalysisSpec>) => onChange({ ...spec, ...patch })

  function setMeasure(index: number, column: string | null, aggregation?: string) {
    const allowed = aggregationsFor(column ? byName.get(column) : undefined)
    const current = spec.measures[index]
    const next = (aggregation ?? current.aggregation) as (typeof allowed)[number]
    const measures = [...spec.measures]
    measures[index] = { column, aggregation: allowed.includes(next) ? next : allowed[0] }
    update({ measures })
  }

  function setFilter(index: number, filter: FilterSpec | null) {
    const filters = [...spec.filters]
    if (filter) filters[index] = filter
    else filters.splice(index, 1)
    update({ filters })
  }

  function addFilter(column: string) {
    const isDate = byName.get(column)?.inferred_type === 'date'
    update({ filters: [...spec.filters, isDate ? { column, start: undefined, end: undefined } : { column, values: [...(profile.filter_options[column] ?? [])] }] })
  }

  return (
    <Card title="Build your analysis">
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (errors.length === 0) onRun()
        }}
      >
        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-semibold text-ink">Measures</legend>
          <p className="-mt-1 text-xs text-ink-muted">Pick what to calculate. Suggested numeric columns are listed first.</p>
          {spec.measures.map((m, i) => {
            const column = m.column ? byName.get(m.column) : undefined
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <div>
                  <label className={labelClass} htmlFor={`${id}-mcol-${i}`}>
                    Column {i + 1}
                  </label>
                  <select
                    id={`${id}-mcol-${i}`}
                    className={selectClass}
                    value={m.column ?? ROW_COUNT}
                    onChange={(e) => setMeasure(i, e.target.value === ROW_COUNT ? null : e.target.value)}
                  >
                    <option value={ROW_COUNT}>Number of rows</option>
                    {[...measureColumns]
                      .sort((a, b) => Number(b.role === 'measure') - Number(a.role === 'measure'))
                      .map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                          {c.inferred_type === 'number' ? '' : ` (${c.inferred_type})`}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor={`${id}-magg-${i}`}>
                    Calculation
                  </label>
                  <select
                    id={`${id}-magg-${i}`}
                    className={selectClass}
                    value={m.aggregation}
                    onChange={(e) => setMeasure(i, m.column, e.target.value)}
                    disabled={!column}
                  >
                    {aggregationsFor(column).map((a) => (
                      <option key={a} value={a}>
                        {AGG_LABELS[a]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Remove measure ${i + 1}`}
                  disabled={spec.measures.length === 1}
                  onClick={() => update({ measures: spec.measures.filter((_, j) => j !== i) })}
                >
                  ✕
                </Button>
              </div>
            )
          })}
          <div>
            <Button
              disabled={spec.measures.length >= MAX_MEASURES}
              onClick={() => update({ measures: [...spec.measures, { column: null, aggregation: 'count' }] })}
            >
              + Add measure
            </Button>
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Group results</legend>
          <div>
            <label className={labelClass} htmlFor={`${id}-group`}>
              Group by
            </label>
            <select
              id={`${id}-group`}
              className={selectClass}
              value={spec.group_by ?? ''}
              onChange={(e) => update({ group_by: e.target.value || null })}
            >
              <option value="">No grouping (totals only)</option>
              {groupable.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.inferred_type === 'date' ? 'date' : `${c.unique_count} values`})
                </option>
              ))}
            </select>
          </div>
          {groupType === 'date' && (
            <div>
              <label className={labelClass} htmlFor={`${id}-grain`}>
                Time period
              </label>
              <select id={`${id}-grain`} className={selectClass} value={spec.time_grain} onChange={(e) => update({ time_grain: e.target.value as TimeGrain })}>
                {GRAINS.map((g) => (
                  <option key={g} value={g}>
                    {g[0].toUpperCase() + g.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-semibold text-ink">Filters</legend>
          {spec.filters.map((f, i) => (
            <div key={`${f.column}-${i}`} className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">{f.column}</p>
                <Button variant="ghost" aria-label={`Remove filter on ${f.column}`} onClick={() => setFilter(i, null)}>
                  Remove
                </Button>
              </div>
              {f.values ? (
                <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
                  {(profile.filter_options[f.column] ?? []).map((value) => (
                    <label key={value} className="flex items-center gap-2 text-sm text-ink-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                        checked={f.values!.includes(value)}
                        onChange={(e) =>
                          setFilter(i, { ...f, values: e.target.checked ? [...f.values!, value] : f.values!.filter((v) => v !== value) })
                        }
                      />
                      {value}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor={`${id}-fs-${i}`}>
                      From
                    </label>
                    <input id={`${id}-fs-${i}`} type="date" className={selectClass} value={f.start ?? ''} onChange={(e) => setFilter(i, { ...f, start: e.target.value || undefined })} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor={`${id}-fe-${i}`}>
                      To (inclusive)
                    </label>
                    <input id={`${id}-fe-${i}`} type="date" className={selectClass} value={f.end ?? ''} onChange={(e) => setFilter(i, { ...f, end: e.target.value || undefined })} />
                  </div>
                </div>
              )}
            </div>
          ))}
          {filterable.length > 0 && (
            <div className="max-w-xs">
              <label className={labelClass} htmlFor={`${id}-addfilter`}>
                Add a filter
              </label>
              <select
                id={`${id}-addfilter`}
                className={selectClass}
                value=""
                onChange={(e) => {
                  if (e.target.value) addFilter(e.target.value)
                }}
              >
                <option value="">Choose a column…</option>
                {filterable.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </fieldset>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--accent)]"
            checked={spec.remove_duplicates}
            onChange={(e) => update({ remove_duplicates: e.target.checked })}
          />
          <span>
            Exclude exact duplicate rows
            <span className="block text-xs text-ink-muted">
              {profile.dataset.duplicate_row_count} duplicate row(s) found. Off by default so nothing is removed without your choice.
            </span>
          </span>
        </label>

        {variantColumns.length > 0 && (
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--accent)]"
              checked={spec.merge_label_variants}
              onChange={(e) => update({ merge_label_variants: e.target.checked })}
            />
            <span>
              Merge labels that differ only by letter case or spacing
              <span className="block text-xs text-ink-muted">
                Found in {variantColumns.join(', ')} (e.g. "North" and "north"). The most common spelling is kept.
              </span>
            </span>
          </label>
        )}

        {errors.length > 0 && (
          <Alert kind="warning" title="Fix these before running">
            <ul className="list-disc pl-4">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}
        <div>
          <Button type="submit" variant="primary" busy={busy} disabled={errors.length > 0}>
            Run analysis
          </Button>
        </div>
      </form>
    </Card>
  )
}

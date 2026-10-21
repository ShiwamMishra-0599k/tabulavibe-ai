import { useId } from 'react'
import { ChartColumn, ChartLine, Funnel, Layers, Play, Plus, Rows3, Settings2, Sigma, WandSparkles, X } from 'lucide-react'
import type { AnalysisSpec, FilterSpec, Profile, TimeGrain } from '../lib/types'
import { AGG_LABELS } from '../lib/format'
import { aggregationsFor, groupableColumns, MAX_MEASURES, ROW_COUNT, suggestedAnalyses, validateSpec, type SuggestedAnalysis } from '../lib/spec'
import { Alert, Button, labelClass, selectClass, Toggle } from './ui'

interface Props {
  profile: Profile
  spec: AnalysisSpec
  onChange: (spec: AnalysisSpec) => void
  onRun: () => void
  onApplySuggestion: (spec: AnalysisSpec) => void
  busy: boolean
}

const GRAINS: TimeGrain[] = ['day', 'week', 'month', 'quarter', 'year']
const SUGGESTION_ICONS: Record<SuggestedAnalysis['kind'], typeof ChartLine> = { trend: ChartLine, compare: ChartColumn, count: Rows3 }

function Section({ icon: Icon, title, hint, children }: { icon: typeof Sigma; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 border-t border-line pt-5 first-of-type:border-t-0 first-of-type:pt-0">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center gap-2" aria-hidden>
        <Icon className="size-4 text-accent" />
        <span className="text-sm font-semibold text-ink">{title}</span>
      </div>
      {hint && <p className="-mt-1.5 text-xs text-ink-muted">{hint}</p>}
      {children}
    </fieldset>
  )
}

export function AnalysisBuilder({ profile, spec, onChange, onRun, onApplySuggestion, busy }: Props) {
  const id = useId()
  const byName = new Map(profile.columns.map((c) => [c.name, c]))
  const measureColumns = profile.columns.filter((c) => c.inferred_type !== 'empty')
  const groupable = groupableColumns(profile)
  const filterable = profile.columns.filter((c) => profile.filter_options[c.name] || c.inferred_type === 'date')
  const errors = validateSpec(spec, profile)
  const groupType = spec.group_by ? byName.get(spec.group_by)?.inferred_type : null
  const variantColumns = profile.columns.filter((c) => c.inferred_type === 'category' && c.notes.some((n) => n.includes('letter case'))).map((c) => c.name)
  const suggestions = suggestedAnalyses(profile)

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
    <div className="grid gap-4">
      {suggestions.length > 0 && (
        <section className="animate-rise gradient-border rounded-2xl p-4 shadow-card" aria-labelledby={`${id}-sugg`}>
          <h2 id={`${id}-sugg`} className="flex items-center gap-2 text-sm font-semibold text-ink">
            <WandSparkles aria-hidden className="size-4 text-accent" />
            Suggested for your data
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">One click to run. You can fine-tune it below.</p>
          <ul className="mt-3 grid gap-2">
            {suggestions.map((s) => {
              const Icon = SUGGESTION_ICONS[s.kind]
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onApplySuggestion(s.spec)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-card disabled:opacity-50"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text transition group-hover:brand-gradient group-hover:text-white">
                      <Icon aria-hidden className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{s.title}</span>
                      <span className="block truncate text-xs text-ink-muted">{s.description}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="mb-5 flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
          <Settings2 aria-hidden className="size-[18px] text-ink-muted" />
          Build your analysis
        </h2>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (errors.length === 0) onRun()
          }}
        >
          <Section icon={Sigma} title="Measures" hint="What to calculate. Numeric columns are listed first.">
            {spec.measures.map((m, i) => {
              const column = m.column ? byName.get(m.column) : undefined
              return (
                <div key={i} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] items-end gap-2">
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
                  <button
                    type="button"
                    aria-label={`Remove measure ${i + 1}`}
                    disabled={spec.measures.length === 1}
                    onClick={() => update({ measures: spec.measures.filter((_, j) => j !== i) })}
                    className="grid size-10 place-items-center rounded-xl text-ink-muted transition hover:bg-bad-soft hover:text-bad disabled:pointer-events-none disabled:opacity-30"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
              )
            })}
            <div>
              <Button
                size="sm"
                variant="ghost"
                icon={Plus}
                disabled={spec.measures.length >= MAX_MEASURES}
                onClick={() => update({ measures: [...spec.measures, { column: null, aggregation: 'count' }] })}
              >
                Add measure
              </Button>
            </div>
          </Section>

          <Section icon={Layers} title="Group results" hint="Break the numbers down by a category or over time.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div>
                <label className={labelClass} htmlFor={`${id}-group`}>
                  Group by
                </label>
                <select id={`${id}-group`} className={selectClass} value={spec.group_by ?? ''} onChange={(e) => update({ group_by: e.target.value || null })}>
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
            </div>
          </Section>

          <Section icon={Funnel} title="Filters" hint="Optional: narrow the rows that are analysed.">
            {spec.filters.map((f, i) => (
              <div key={`${f.column}-${i}`} className="animate-rise rounded-xl border border-line bg-surface-2/50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{f.column}</p>
                  <Button size="sm" variant="ghost" icon={X} aria-label={`Remove filter on ${f.column}`} onClick={() => setFilter(i, null)}>
                    Remove
                  </Button>
                </div>
                {f.values ? (
                  <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                    {(profile.filter_options[f.column] ?? []).map((value) => {
                      const on = f.values!.includes(value)
                      return (
                        <label
                          key={value}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition ${
                            on ? 'border-accent/50 bg-accent-soft text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="check"
                            checked={on}
                            onChange={(e) => setFilter(i, { ...f, values: e.target.checked ? [...f.values!, value] : f.values!.filter((v) => v !== value) })}
                          />
                          {value}
                        </label>
                      )
                    })}
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
              <div>
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
          </Section>

          <Section icon={Settings2} title="Cleaning options" hint="Off by default: nothing is removed or changed without your choice.">
            <Toggle
              checked={spec.remove_duplicates}
              onChange={(v) => update({ remove_duplicates: v })}
              label="Exclude exact duplicate rows"
              description={`${profile.dataset.duplicate_row_count} duplicate row(s) found.`}
            />
            {variantColumns.length > 0 && (
              <Toggle
                checked={spec.merge_label_variants}
                onChange={(v) => update({ merge_label_variants: v })}
                label="Merge labels that differ only by letter case or spacing"
                description={`Found in ${variantColumns.join(', ')} (e.g. "North" and "north"). The most common spelling is kept.`}
              />
            )}
          </Section>

          {errors.length > 0 && (
            <Alert kind="warning" title="Fix these before running">
              <ul className="list-disc pl-4">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
          <Button type="submit" variant="primary" size="lg" icon={Play} busy={busy} disabled={errors.length > 0} className="w-full">
            Run analysis
          </Button>
        </form>
      </section>
    </div>
  )
}

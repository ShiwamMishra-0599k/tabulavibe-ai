import type { Aggregation, AnalysisSpec, ColumnProfile, Profile } from './types'

export const NUMERIC_AGGREGATIONS: Aggregation[] = ['sum', 'mean', 'min', 'max', 'count']
export const ROW_COUNT = '__rows__'
export const MAX_MEASURES = 6

export function aggregationsFor(column: ColumnProfile | undefined): Aggregation[] {
  return column?.inferred_type === 'number' ? NUMERIC_AGGREGATIONS : ['count']
}

export function groupableColumns(profile: Profile): ColumnProfile[] {
  return profile.columns.filter(
    (c) => c.inferred_type === 'date' || ((c.inferred_type === 'category' || c.inferred_type === 'boolean') && c.unique_count >= 1),
  )
}

/** A sensible starting analysis built from the server's schema suggestions. */
export function defaultSpec(profile: Profile): AnalysisSpec {
  const { measures, dates, dimensions } = profile.suggestions
  return {
    measures: measures.length ? [{ column: measures[0], aggregation: 'sum' }, { column: null, aggregation: 'count' }] : [{ column: null, aggregation: 'count' }],
    group_by: dates[0] ?? dimensions[0] ?? null,
    time_grain: 'month',
    filters: [],
    remove_duplicates: false,
    merge_label_variants: false,
  }
}

export interface SuggestedAnalysis {
  id: string
  title: string
  description: string
  kind: 'trend' | 'compare' | 'count'
  spec: AnalysisSpec
}

/** Up to three one-click analyses built from the server's schema suggestions (no calculation happens here). */
export function suggestedAnalyses(profile: Profile): SuggestedAnalysis[] {
  const { measures, dates, dimensions } = profile.suggestions
  const base = { time_grain: 'month' as const, filters: [], remove_duplicates: false, merge_label_variants: false }
  const out: SuggestedAnalysis[] = []
  const [measure] = measures
  const [date] = dates
  const [dimension] = dimensions
  if (measure && date) {
    out.push({
      id: 'trend',
      kind: 'trend',
      title: `${measure} by month`,
      description: `Monthly total of ${measure}, as a trend line`,
      spec: { ...base, measures: [{ column: measure, aggregation: 'sum' }], group_by: date },
    })
  }
  if (measure && dimension) {
    out.push({
      id: 'compare',
      kind: 'compare',
      title: `${measure} by ${dimension}`,
      description: `Compare total ${measure} across ${dimension}`,
      spec: { ...base, measures: [{ column: measure, aggregation: 'sum' }], group_by: dimension },
    })
  }
  if (dimension) {
    out.push({
      id: 'count',
      kind: 'count',
      title: `Rows per ${dimension}`,
      description: `How many records fall in each ${dimension}`,
      spec: { ...base, measures: [{ column: null, aggregation: 'count' }], group_by: dimension },
    })
  } else if (date) {
    out.push({
      id: 'count',
      kind: 'count',
      title: 'Rows per month',
      description: `How many records there are each month (${date})`,
      spec: { ...base, measures: [{ column: null, aggregation: 'count' }], group_by: date },
    })
  }
  return out.slice(0, 3)
}

/** Client-side mirror of the server rules, so invalid combinations are caught before a request. */
export function validateSpec(spec: AnalysisSpec, profile: Profile): string[] {
  const errors: string[] = []
  const byName = new Map(profile.columns.map((c) => [c.name, c]))
  const seen = new Set<string>()
  if (spec.measures.length === 0) errors.push('Add at least one measure.')
  for (const m of spec.measures) {
    const key = `${m.aggregation}:${m.column ?? ROW_COUNT}`
    if (seen.has(key)) errors.push('The same measure is selected twice.')
    seen.add(key)
    if (m.column && !aggregationsFor(byName.get(m.column)).includes(m.aggregation)) {
      errors.push(`'${m.column}' is not numeric, so only Count can be used.`)
    }
  }
  for (const f of spec.filters) {
    if (f.values && f.values.length === 0) errors.push(`Select at least one value for the '${f.column}' filter, or remove it.`)
    if (!f.values && !f.start && !f.end) errors.push(`Choose a start or end date for the '${f.column}' filter, or remove it.`)
    if (f.start && f.end && f.start > f.end) errors.push(`The '${f.column}' start date is after the end date.`)
  }
  return [...new Set(errors)]
}

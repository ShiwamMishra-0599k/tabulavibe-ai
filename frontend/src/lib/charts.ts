import type { AnalysisResult } from './types'

// Fixed categorical order from the validated palette; colour follows the entity, never cycled.
export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)

export type ChartKind = 'line' | 'bar' | 'pie' | 'table'

export function chartTitle(result: AnalysisResult, measureKey: string): string {
  const measure = result.measures.find((m) => m.key === measureKey) ?? result.measures[0]
  if (!result.grouping) return measure.label
  const by = result.grouping.time_grain ? `${result.grouping.time_grain} (${result.grouping.column})` : result.grouping.column
  return `${measure.label} by ${by}`
}

import type { ChartKind } from './charts'
import type { SavedReport } from './types'

/** The export payload for a saved report: exactly the stored, validated results (nothing recalculated). */
export function savedExportData(report: SavedReport) {
  const chartKind: ChartKind = report.result.chart.recommended === 'line' ? 'line' : 'bar'
  return {
    dataset: report.quality.dataset,
    issues: report.quality.issues,
    result: report.result,
    narrative: report.narrative,
    chart_kind: chartKind,
    measure_key: report.result.measures[0]?.key,
  }
}

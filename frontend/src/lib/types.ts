export type InferredType = 'number' | 'date' | 'boolean' | 'category' | 'text' | 'empty'
export type Aggregation = 'sum' | 'mean' | 'count' | 'min' | 'max'
export type TimeGrain = 'day' | 'week' | 'month' | 'quarter' | 'year'

export interface AppConfig {
  limits: {
    max_upload_mb: number
    max_rows: number
    max_columns: number
    max_cells: number
    supported_extensions: string[]
  }
  ai: { enabled: boolean; provider: string | null; model: string | null }
}

export interface SampleInfo {
  id: string
  file_name: string
  title: string
  description: string
}

export interface ColumnProfile {
  name: string
  inferred_type: InferredType
  role: 'measure' | 'dimension' | 'time' | 'identifier' | 'other'
  missing_count: number
  missing_pct: number
  invalid_count: number
  invalid_examples: string[]
  unique_count: number
  date_format: string | null
  notes: string[]
  numeric_stats: {
    count: number
    sum: number | null
    mean: number | null
    median: number | null
    std: number | null
    min: number | null
    max: number | null
  } | null
  date_range: { min: string; max: string } | null
  top_values: { value: string; count: number }[] | null
}

export interface Issue {
  severity: 'info' | 'warning'
  code: string
  message: string
}

export interface Profile {
  dataset: {
    file_name: string
    file_type: 'csv' | 'xlsx'
    sheet_name: string | null
    row_count: number
    column_count: number
    duplicate_row_count: number
    missing_cell_count: number
    missing_cell_pct: number
    empty_rows_skipped: number
  }
  columns: ColumnProfile[]
  issues: Issue[]
  notes: string[]
  preview: { columns: string[]; rows: string[][]; total_rows: number }
  suggestions: { measures: string[]; dimensions: string[]; dates: string[] }
  filter_options: Record<string, string[]>
}

export interface MeasureSpec {
  column: string | null
  aggregation: Aggregation
}

export interface FilterSpec {
  column: string
  values?: string[]
  start?: string
  end?: string
}

export interface AnalysisSpec {
  measures: MeasureSpec[]
  group_by: string | null
  time_grain: TimeGrain
  filters: FilterSpec[]
  remove_duplicates: boolean
  merge_label_variants: boolean
}

export interface Kpi {
  key: string
  label: string
  column: string | null
  aggregation: Aggregation
  value: number | null
  values_used: number
  values_excluded: number
  definition: string
}

export interface ResultRow {
  group: string
  row_count: number
  values: Record<string, number | null>
}

export interface AnalysisResult {
  row_count: number
  rows_analyzed: number
  kpis: Kpi[]
  grouping: {
    column: string
    type: InferredType
    time_grain: TimeGrain | null
    total_groups: number
    truncated: boolean
  } | null
  rows: ResultRow[]
  measures: { key: string; label: string; aggregation: Aggregation }[]
  chart: {
    recommended: 'kpi' | 'line' | 'bar'
    pie_allowed: boolean
    pie_reason: string | null
    notes: string[]
  }
  notes: string[]
  spec: AnalysisSpec
}

export interface Narrative {
  provider: string
  model: string
  text: string
  generated_at: string
  disclaimer: string
  shared_payload: Record<string, unknown>
}

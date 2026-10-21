import type { AnalysisResult, AppConfig, ColumnProfile, Profile } from '../lib/types'

const col = (name: string, inferred_type: ColumnProfile['inferred_type'], role: ColumnProfile['role'], extra: Partial<ColumnProfile> = {}): ColumnProfile => ({
  name,
  inferred_type,
  role,
  missing_count: 0,
  missing_pct: 0,
  invalid_count: 0,
  invalid_examples: [],
  unique_count: 4,
  date_format: null,
  notes: [],
  numeric_stats: null,
  date_range: null,
  top_values: null,
  ...extra,
})

export const config: AppConfig = {
  limits: { max_upload_mb: 4, max_rows: 100000, max_columns: 60, max_cells: 2000000, supported_extensions: ['.csv', '.xlsx'] },
  ai: { enabled: false, provider: null, model: null },
}

export const profile: Profile = {
  dataset: {
    file_name: 'sales.csv',
    file_type: 'csv',
    sheet_name: null,
    row_count: 10,
    column_count: 4,
    duplicate_row_count: 1,
    missing_cell_count: 1,
    missing_cell_pct: 2.5,
    empty_rows_skipped: 0,
  },
  columns: [
    col('date', 'date', 'time', { date_range: { min: '2025-01-05T00:00:00', max: '2025-05-30T00:00:00' } }),
    col('region', 'category', 'dimension', { notes: ["1 value(s) differ from another value only by letter case or spacing (for example 'North' and 'north'); they are treated as separate values."] }),
    col('revenue', 'number', 'measure', {
      missing_count: 1,
      missing_pct: 10,
      numeric_stats: { count: 9, sum: 355, mean: 39.44, median: 30, std: 22.1, min: 10, max: 70 },
    }),
    col('order_id', 'text', 'identifier', { unique_count: 10 }),
  ],
  issues: [
    { severity: 'warning', code: 'duplicate_rows', message: '1 row(s) are exact duplicates of an earlier row.' },
    { severity: 'info', code: 'missing_values', message: "'revenue' has 1 missing value(s) (10.0%)." },
  ],
  notes: [],
  preview: {
    columns: ['date', 'region', 'revenue', 'order_id'],
    rows: [
      ['2025-01-05', 'North', '50.00', 'A1'],
      ['2025-01-20', 'South', '', 'A2'],
    ],
    total_rows: 10,
  },
  suggestions: { measures: ['revenue'], dimensions: ['region'], dates: ['date'] },
  filter_options: { region: ['East', 'North', 'South', 'West'] },
}

export const result: AnalysisResult = {
  row_count: 10,
  rows_analyzed: 10,
  kpis: [
    {
      key: 'sum__revenue',
      label: 'Sum of revenue',
      column: 'revenue',
      aggregation: 'sum',
      value: 1645592.43,
      values_used: 9,
      values_excluded: 1,
      definition: "Total of all 'revenue' values (9 value(s) used; 1 missing or invalid value(s) excluded).",
    },
  ],
  grouping: { column: 'region', type: 'category', time_grain: null, total_groups: 2, truncated: false },
  rows: [
    { group: 'South', row_count: 3, values: { sum__revenue: 190 } },
    { group: 'North', row_count: 4, values: { sum__revenue: 135 } },
  ],
  measures: [{ key: 'sum__revenue', label: 'Sum of revenue', aggregation: 'sum' }],
  chart: { recommended: 'bar', pie_allowed: true, pie_reason: null, notes: [] },
  notes: [],
  spec: { measures: [{ column: 'revenue', aggregation: 'sum' }], group_by: 'region', time_grain: 'month', filters: [], remove_duplicates: false, merge_label_variants: false },
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

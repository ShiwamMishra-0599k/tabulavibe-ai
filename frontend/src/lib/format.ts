// [ASSUMPTION] Indian digit grouping (12,34,567) suits the target users; change LOCALE to adapt.
export const LOCALE = 'en-IN'

const full = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return full.format(value)
}

export function formatCompact(value: number): string {
  return Math.abs(value) < 1000 ? full.format(value) : compact.format(value)
}

export function formatCount(value: number): string {
  return integer.format(value)
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: 1 })}%`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
}

export const TYPE_LABELS: Record<string, string> = {
  number: 'Number',
  date: 'Date',
  boolean: 'Yes / No',
  category: 'Category',
  text: 'Text',
  empty: 'Empty',
}

export const AGG_LABELS: Record<string, string> = {
  sum: 'Sum',
  mean: 'Average',
  count: 'Count',
  min: 'Minimum',
  max: 'Maximum',
}

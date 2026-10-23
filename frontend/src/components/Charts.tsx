import { useId } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ResultRow } from '../lib/types'
import { SERIES } from '../lib/charts'
import { formatCompact, formatCount, formatNumber } from '../lib/format'

const MAX_BARS = 20

interface ChartProps {
  rows: ResultRow[]
  measureKey: string
  measureLabel: string
  height?: number
}

interface Datum {
  group: string
  value: number | null
  rows: number
  /** 1-based position by value among the groups shown (ordering only; nothing is calculated). */
  rank?: number
  of?: number
}

function toData(rows: ResultRow[], key: string): Datum[] {
  return rows.map((r) => ({ group: r.group, value: r.values[key], rows: r.row_count }))
}

function ranked(data: Datum[]): Datum[] {
  const order = [...data].filter((d) => d.value !== null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  return data.map((d) => (d.value === null ? d : { ...d, rank: order.indexOf(d) + 1, of: order.length }))
}

/** Width of the category axis from the longest label shown (bounded so bars keep most of the space). */
function labelWidth(data: Datum[]): number {
  const longest = data.reduce((m, d) => Math.max(m, d.group.length), 0)
  return Math.min(160, Math.max(56, Math.round(longest * 7.4) + 10))
}

interface TooltipProps {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: unknown }>
  measureLabel: string
}

function ChartTooltip({ active, payload, measureLabel }: TooltipProps) {
  const datum = payload?.[0]?.payload as Datum | undefined
  if (!active || !datum) return null
  return (
    <div className="rounded-xl border border-line bg-glass px-3 py-2 text-xs shadow-float backdrop-blur-md">
      <p className="font-semibold text-ink">{datum.group}</p>
      <p className="tabular mt-0.5 text-ink-2">
        {measureLabel}: <span className="font-semibold text-ink">{formatNumber(datum.value)}</span>
      </p>
      <p className="tabular text-ink-muted">
        {formatCount(datum.rows)} rows{datum.rank ? ` · rank ${datum.rank} of ${datum.of}` : ''}
      </p>
    </div>
  )
}

const axisTick = { fill: 'var(--ink-muted)', fontSize: 12 }

export function TrendChart({ rows, measureKey, measureLabel, height = 320 }: ChartProps) {
  const data = toData(rows, measureKey)
  const gradientId = `trend-${useId().replace(/:/g, '')}`
  return (
    <div role="img" aria-label={`Line chart of ${measureLabel} over time`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.22} />
              <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="group" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} minTickGap={16} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatCompact} width={56} />
          <Tooltip
            content={(props) => <ChartTooltip active={props.active} payload={props.payload} measureLabel={measureLabel} />}
            cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
          />
          <Area
            type="linear"
            dataKey="value"
            stroke={SERIES[0]}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={{ r: 4, fill: SERIES[0], stroke: 'var(--surface)', strokeWidth: 2 }}
            activeDot={{ r: 6, fill: SERIES[0], stroke: 'var(--surface)', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function BarComparison({ rows, measureKey, measureLabel }: ChartProps) {
  const data = ranked(toData(rows, measureKey)).slice(0, MAX_BARS)
  const height = Math.max(160, data.length * 36 + 40)
  return (
    <div role="img" aria-label={`Bar chart of ${measureLabel} by group`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }} barCategoryGap={6}>
          <CartesianGrid stroke="var(--line)" horizontal={false} />
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatCompact} />
          <YAxis type="category" dataKey="group" tick={{ ...axisTick, fill: 'var(--ink-2)' }} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} width={labelWidth(data)} />
          <Tooltip
            content={(props) => <ChartTooltip active={props.active} payload={props.payload} measureLabel={measureLabel} />}
            cursor={{ fill: 'var(--surface-2)', radius: 8 }}
          />
          <Bar
            dataKey="value"
            fill={SERIES[0]}
            maxBarSize={24}
            radius={[0, 6, 6, 0]}
            isAnimationActive={false}
            label={{ position: 'right', fill: 'var(--ink-2)', fontSize: 12, fontWeight: 600, formatter: (v: unknown) => (typeof v === 'number' ? formatCompact(v) : '') }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ShareChart({ rows, measureKey, measureLabel, total }: ChartProps & { total: number | null }) {
  const data = ranked(toData(rows, measureKey))
  const sum = data.reduce((acc, d) => acc + (d.value ?? 0), 0)
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[1fr_1fr]">
      <div className="relative" role="img" aria-label={`Donut chart of ${measureLabel} share by group`} style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="group"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1.5}
              cornerRadius={4}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell key={d.group} fill={SERIES[i]} />
              ))}
            </Pie>
            <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} measureLabel={measureLabel} />} />
          </PieChart>
        </ResponsiveContainer>
        {total !== null && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-xs font-medium text-ink-muted">Total</p>
              <p className="text-xl font-bold tracking-tight text-ink">{formatCompact(total)}</p>
            </div>
          </div>
        )}
      </div>
      <ul className="grid gap-2 text-sm" aria-label="Legend">
        {data.map((d, i) => (
          <li key={d.group} className="flex items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-surface-2">
            <span aria-hidden className="size-3 shrink-0 rounded" style={{ background: SERIES[i] }} />
            <span className="min-w-0 flex-1 truncate text-ink">{d.group}</span>
            <span className="tabular font-semibold text-ink-2">{sum ? `${((100 * (d.value ?? 0)) / sum).toFixed(1)}%` : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

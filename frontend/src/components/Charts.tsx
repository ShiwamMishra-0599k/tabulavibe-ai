import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
}

function toData(rows: ResultRow[], key: string): Datum[] {
  return rows.map((r) => ({ group: r.group, value: r.values[key], rows: r.row_count }))
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
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-ink">{datum.group}</p>
      <p className="tabular text-ink-2">
        {measureLabel}: <span className="font-medium text-ink">{formatNumber(datum.value)}</span>
      </p>
      <p className="tabular text-ink-muted">{formatCount(datum.rows)} rows</p>
    </div>
  )
}

const axisTick = { fill: 'var(--ink-muted)', fontSize: 12 }

export function TrendChart({ rows, measureKey, measureLabel, height = 320 }: ChartProps) {
  const data = toData(rows, measureKey)
  return (
    <div role="img" aria-label={`Line chart of ${measureLabel} over time`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="group" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} minTickGap={16} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatCompact} width={56} />
          <Tooltip
            content={(props) => <ChartTooltip active={props.active} payload={props.payload} measureLabel={measureLabel} />}
            cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke={SERIES[0]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 4, fill: SERIES[0], stroke: 'var(--surface)', strokeWidth: 2 }}
            activeDot={{ r: 6, fill: SERIES[0], stroke: 'var(--surface)', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function BarComparison({ rows, measureKey, measureLabel }: ChartProps) {
  const data = toData(rows, measureKey).slice(0, MAX_BARS)
  const height = Math.max(160, data.length * 32 + 40)
  return (
    <div role="img" aria-label={`Bar chart of ${measureLabel} by group`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap={4}>
          <CartesianGrid stroke="var(--line)" horizontal={false} />
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatCompact} />
          <YAxis type="category" dataKey="group" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} width={120} />
          <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} measureLabel={measureLabel} />} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar
            dataKey="value"
            fill={SERIES[0]}
            maxBarSize={24}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            label={{ position: 'right', fill: 'var(--ink-2)', fontSize: 12, formatter: (v: unknown) => (typeof v === 'number' ? formatCompact(v) : '') }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ShareChart({ rows, measureKey, measureLabel }: ChartProps) {
  const data = toData(rows, measureKey)
  const total = data.reduce((sum, d) => sum + (d.value ?? 0), 0)
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[1fr_1fr]">
      <div role="img" aria-label={`Donut chart of ${measureLabel} share by group`} style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="group"
              innerRadius="55%"
              outerRadius="90%"
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
      </div>
      <ul className="grid gap-1.5 text-sm" aria-label="Legend">
        {data.map((d, i) => (
          <li key={d.group} className="flex items-center gap-2">
            <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ background: SERIES[i] }} />
            <span className="min-w-0 flex-1 truncate text-ink">{d.group}</span>
            <span className="tabular text-ink-2">{total ? `${((100 * (d.value ?? 0)) / total).toFixed(1)}%` : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

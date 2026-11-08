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
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-float">
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
  const last = data.length - 1
  return (
    <div role="img" aria-label={`Line chart of ${measureLabel} over time`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
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
            stroke="var(--ink)"
            strokeWidth={2}
            // v3: flat 8% ink wash (no gradient); the latest period is the one Burnt Orange point.
            fill="var(--ink)"
            fillOpacity={0.08}
            dot={(p: { cx?: number; cy?: number; index?: number }) =>
              p.cx == null || p.cy == null ? (
                <g key={`dot-${p.index}`} />
              ) : (
                <circle key={`dot-${p.index}`} cx={p.cx} cy={p.cy} r={p.index === last ? 5 : 3.5} fill={p.index === last ? 'var(--accent)' : 'var(--ink)'} stroke="var(--surface)" strokeWidth={2} />
              )
            }
            activeDot={{ r: 6, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }}
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
            cursor={{ fill: 'var(--surface-2)', radius: 2 }}
          />
          <Bar
            dataKey="value"
            fill="var(--chart-base)"
            maxBarSize={20}
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
            label={{ position: 'right', fill: 'var(--ink-2)', fontSize: 12, fontWeight: 600, formatter: (v: unknown) => (typeof v === 'number' ? formatCompact(v) : '') }}
          >
            {/* Bars are sorted largest first: the top group is the one Burnt Orange mark, the rest ink. */}
            {data.map((d, i) => (
              <Cell key={d.group} fill={i === 0 ? 'var(--accent)' : 'var(--chart-base)'} />
            ))}
          </Bar>
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

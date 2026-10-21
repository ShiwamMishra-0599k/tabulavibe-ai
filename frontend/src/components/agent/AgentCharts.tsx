import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SERIES } from '../../lib/charts'
import { formatCompact, formatCount, formatNumber } from '../../lib/format'

const axisTick = { fill: 'var(--ink-muted)', fontSize: 12 }

interface Bin {
  start: number | null
  end: number | null
  count: number
}

/** Histogram from bins computed by the server (no binning in the browser). */
export function Histogram({ bins, label }: { bins: Bin[]; label: string }) {
  const data = bins.map((b) => ({ range: `${formatCompact(b.start ?? 0)}–${formatCompact(b.end ?? 0)}`, count: b.count, start: b.start, end: b.end }))
  return (
    <div role="img" aria-label={`Histogram of ${label}`} style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barCategoryGap={1}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="range" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} minTickGap={20} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as (typeof data)[number] | undefined
              if (!active || !d) return null
              return (
                <div className="rounded-xl border border-line bg-glass px-3 py-2 text-xs shadow-float backdrop-blur-md">
                  <p className="tabular font-semibold text-ink">
                    {formatNumber(d.start)} to {formatNumber(d.end)}
                  </p>
                  <p className="tabular text-ink-2">{formatCount(d.count)} values</p>
                </div>
              )
            }}
          />
          <Bar dataKey="count" fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

interface BoxStats {
  min: number | null
  q1: number | null
  median: number | null
  q3: number | null
  max: number | null
  lower_fence: number | null
  upper_fence: number | null
  outlier_count?: number
}

/** Horizontal box plot from server quartiles; whiskers stop at the IQR fences (or min/max if inside). */
export function BoxPlot({ stats, label }: { stats: BoxStats; label: string }) {
  const { min, q1, median, q3, max, lower_fence, upper_fence } = stats
  if ([min, q1, median, q3, max].some((v) => v === null)) return null
  const lo = min as number
  const hi = max as number
  const span = hi - lo || 1
  const x = (v: number) => 8 + ((v - lo) / span) * 284
  const wLo = Math.max(lo, lower_fence ?? lo)
  const wHi = Math.min(hi, upper_fence ?? hi)
  return (
    <figure className="grid gap-1">
      <svg viewBox="0 0 300 56" className="h-16 w-full" role="img" aria-label={`Box plot of ${label}: median ${formatNumber(median)}, quartiles ${formatNumber(q1)} to ${formatNumber(q3)}`}>
        <line x1={x(wLo)} x2={x(q1 as number)} y1={28} y2={28} stroke="var(--ink-muted)" strokeWidth={1.5} />
        <line x1={x(q3 as number)} x2={x(wHi)} y1={28} y2={28} stroke="var(--ink-muted)" strokeWidth={1.5} />
        <line x1={x(wLo)} x2={x(wLo)} y1={20} y2={36} stroke="var(--ink-muted)" strokeWidth={1.5} />
        <line x1={x(wHi)} x2={x(wHi)} y1={20} y2={36} stroke="var(--ink-muted)" strokeWidth={1.5} />
        <rect x={x(q1 as number)} y={14} width={Math.max(1, x(q3 as number) - x(q1 as number))} height={28} rx={4} fill={SERIES[0]} fillOpacity={0.18} stroke={SERIES[0]} strokeWidth={1.5} />
        <line x1={x(median as number)} x2={x(median as number)} y1={14} y2={42} stroke={SERIES[0]} strokeWidth={2.5} />
        {lo < wLo && <circle cx={x(lo)} cy={28} r={3} fill="var(--warn)" />}
        {hi > wHi && <circle cx={x(hi)} cy={28} r={3} fill="var(--warn)" />}
      </svg>
      <figcaption className="tabular flex justify-between text-[11px] text-ink-muted">
        <span>{formatNumber(lo)}</span>
        <span>
          Q1 {formatNumber(q1)} · median {formatNumber(median)} · Q3 {formatNumber(q3)}
        </span>
        <span>{formatNumber(hi)}</span>
      </figcaption>
    </figure>
  )
}

/** Correlation heatmap: blue for positive, orange for negative, strength by intensity. */
export function CorrelationHeatmap({ columns, matrix, label }: { columns: string[]; matrix: (number | null)[][]; label: string }) {
  const cell = (r: number | null) => {
    if (r === null) return { background: 'var(--surface-2)' }
    const colour = r >= 0 ? 'var(--series-1)' : 'var(--series-2)'
    return { background: `color-mix(in oklab, ${colour} ${Math.round(Math.abs(r) * 85)}%, var(--surface))`, color: Math.abs(r) > 0.55 ? 'white' : 'var(--ink)' }
  }
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="tabular border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c} scope="col" className="max-w-24 truncate px-1 text-left font-medium text-ink-muted" title={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((row, i) => (
            <tr key={row}>
              <th scope="row" className="max-w-32 truncate pr-2 text-right font-medium text-ink-muted" title={row}>
                {row}
              </th>
              {columns.map((col, j) => (
                <td key={col} className="size-14 rounded-md text-center font-semibold" style={cell(matrix[i][j])} title={`${row} × ${col}: ${matrix[i][j] ?? 'n/a'}`}>
                  {matrix[i][j] === null ? '–' : (matrix[i][j] as number).toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Explained variance per principal component, as horizontal bars. */
export function VarianceBars({ ratios }: { ratios: (number | null)[] }) {
  return (
    <ul aria-label="Explained variance by component" className="grid gap-2">
      {ratios.map((r, i) => (
        <li key={i} className="grid grid-cols-[3rem_1fr_3.5rem] items-center gap-2 text-xs">
          <span className="font-semibold text-ink-2">PC{i + 1}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full" style={{ width: `${(r ?? 0) * 100}%`, background: SERIES[0] }} />
          </span>
          <span className="tabular text-right text-ink-muted">{((r ?? 0) * 100).toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  )
}

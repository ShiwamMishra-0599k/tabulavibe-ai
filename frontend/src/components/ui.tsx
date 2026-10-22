import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'soft'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary:
    'brand-gradient text-white shadow-[0_8px_20px_-8px_rgb(79_70_229/0.7)] hover:brightness-110 hover:shadow-[0_10px_24px_-8px_rgb(79_70_229/0.8)] border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-accent/50 hover:bg-surface-2 shadow-soft',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 hover:text-ink',
  soft: 'bg-accent-soft text-accent-text border border-transparent hover:brightness-95',
}
const SIZES: Record<Size, string> = {
  sm: 'min-h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'min-h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'min-h-12 px-6 text-base gap-2 rounded-xl',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  icon: Icon,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean; icon?: LucideIcon }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center font-semibold transition duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : Icon && <Icon aria-hidden className="size-4 shrink-0" />}
      {children}
    </button>
  )
}

export function Card({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className = '',
  highlight = false,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  highlight?: boolean
}) {
  return (
    <section
      className={`rounded-2xl p-4 shadow-card sm:p-6 ${highlight ? 'gradient-border' : 'border border-line bg-surface'} ${className}`}
    >
      {(title || actions) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && <IconChip icon={Icon} />}
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function IconChip({ icon: Icon, tone = 'accent', size = 'md' }: { icon: LucideIcon; tone?: 'accent' | 'brand' | 'good' | 'warn' | 'bad' | 'neutral'; size?: 'sm' | 'md' | 'lg' }) {
  const tones = {
    accent: 'bg-accent-soft text-accent-text',
    brand: 'brand-gradient text-white shadow-[0_6px_16px_-6px_rgb(79_70_229/0.7)]',
    good: 'bg-good-soft text-good',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
    neutral: 'bg-surface-2 text-ink-2',
  }
  const sizes = { sm: 'size-7 rounded-lg [&>svg]:size-3.5', md: 'size-9 rounded-xl [&>svg]:size-[18px]', lg: 'size-12 rounded-2xl [&>svg]:size-6' }
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center ${tones[tone]} ${sizes[size]}`}>
      <Icon />
    </span>
  )
}

const ALERT = {
  error: { box: 'border-bad/30 bg-bad-soft', icon: CircleX, color: 'text-bad' },
  warning: { box: 'border-warn/30 bg-warn-soft', icon: TriangleAlert, color: 'text-warn' },
  info: { box: 'border-line bg-surface-2', icon: Info, color: 'text-accent-text' },
  success: { box: 'border-good/30 bg-good-soft', icon: CircleCheck, color: 'text-good' },
}

export function Alert({ kind = 'info', title, children }: { kind?: keyof typeof ALERT; title?: string; children?: ReactNode }) {
  const { box, icon: Icon, color } = ALERT[kind]
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`animate-rise flex gap-3 rounded-xl border p-3.5 text-sm ${box}`}>
      <Icon aria-hidden className={`mt-0.5 size-[18px] shrink-0 ${color}`} />
      <div className="min-w-0">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role={label ? 'status' : undefined}>
      <LoaderCircle aria-hidden className="size-5 animate-spin text-accent" />
      {label && <span className="text-sm text-ink-2">{label}</span>}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-xl ${className}`} />
}

export function Badge({ children, tone = 'neutral', icon: Icon }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'good' | 'bad'; icon?: LucideIcon }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2 ring-line',
    accent: 'bg-accent-soft text-accent-text ring-accent/20',
    warn: 'bg-warn-soft text-warn ring-warn/20',
    good: 'bg-good-soft text-good ring-good/20',
    bad: 'bg-bad-soft text-bad ring-bad/20',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tones[tone]}`}>
      {Icon && <Icon aria-hidden className="size-3" />}
      {children}
    </span>
  )
}

export function Stat({ label, value, hint, icon, tone = 'accent' }: { label: string; value: ReactNode; hint?: ReactNode; icon: LucideIcon; tone?: 'accent' | 'good' | 'warn' | 'bad' | 'neutral' }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <IconChip icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink-muted">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      </div>
    </div>
  )
}

/** Circular gauge for a 0–100 value computed by the server. */
export function ProgressRing({ value, size = 120, label }: { value: number; size?: number; label: string }) {
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  const tone = clamped >= 95 ? 'var(--good)' : clamped >= 80 ? 'var(--accent)' : 'var(--warn)'
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${clamped}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.2, 0.7, 0.2, 1)' }}
        />
      </svg>
      <span className="absolute text-2xl font-bold tracking-tight text-ink">{clamped}%</span>
    </div>
  )
}

/** Thin horizontal bar for a 0–100 value computed by the server. */
export function Meter({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value))
  const tone = clamped >= 95 ? 'bg-good' : clamped >= 80 ? 'bg-accent' : 'bg-warn'
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${label}: ${clamped}%`}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="tabular text-xs text-ink-muted">{clamped}%</span>
    </div>
  )
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 transition hover:border-accent/40 hover:bg-surface-2">
      {/* A real checkbox styled as a switch (see .switch in index.css), so it stays keyboard- and screen-reader-native. */}
      <input type="checkbox" className="switch mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  )
}

export const selectClass =
  'min-h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink shadow-soft transition hover:border-accent/50 focus:border-accent disabled:opacity-50'
export const labelClass = 'mb-1.5 block text-xs font-semibold text-ink-2'

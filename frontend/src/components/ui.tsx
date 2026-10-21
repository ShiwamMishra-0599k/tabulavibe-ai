import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90 border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-surface-2',
}

export function Button({
  variant = 'secondary',
  busy = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  )
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

const ALERT_STYLES = {
  error: 'border-bad/40 bg-bad-soft text-ink',
  warning: 'border-warn/40 bg-warn-soft text-ink',
  info: 'border-line bg-surface-2 text-ink',
  success: 'border-good/40 bg-good-soft text-ink',
}
const ALERT_ICONS = { error: '✕', warning: '!', info: 'i', success: '✓' }
const ALERT_ICON_COLORS = { error: 'bg-bad', warning: 'bg-warn', info: 'bg-ink-muted', success: 'bg-good' }

export function Alert({ kind = 'info', title, children }: { kind?: keyof typeof ALERT_STYLES; title?: string; children?: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg border p-3 text-sm ${ALERT_STYLES[kind]}`}>
      <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-surface ${ALERT_ICON_COLORS[kind]}`}>
        {ALERT_ICONS[kind]}
      </span>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
      </div>
    </div>
  )
}

export function Spinner({ small = false, label }: { small?: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role={label ? 'status' : undefined}>
      <span aria-hidden className={`${small ? 'size-4' : 'size-5'} animate-spin rounded-full border-2 border-current border-t-transparent`} />
      {label && <span className="text-sm text-ink-2">{label}</span>}
    </span>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'good' }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-soft text-ink',
    warn: 'bg-warn-soft text-ink',
    good: 'bg-good-soft text-ink',
  }
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-2">{hint}</p>}
    </div>
  )
}

export const selectClass =
  'min-h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink disabled:opacity-50'
export const labelClass = 'mb-1 block text-xs font-medium text-ink-2'

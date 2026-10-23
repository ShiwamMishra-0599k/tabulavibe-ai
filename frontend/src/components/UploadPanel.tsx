import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  Bot,
  ChartColumn,
  CircleCheck,
  CloudUpload,
  FileSpreadsheet,
  Lock,
  LogIn,
  ScanSearch,
  Share2,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
  Zap,
} from 'lucide-react'
import type { AppConfig, SampleInfo } from '../lib/types'
import { formatCount } from '../lib/format'
import { SERIES } from '../lib/charts'
import { Badge, Button, IconChip, Skeleton } from './ui'

interface Props {
  config: AppConfig | null
  samples: SampleInfo[]
  busy: boolean
  onFile: (file: File) => void
  onSample: (sample: SampleInfo) => void
  /** Set when the server requires sign-in and nobody is signed in: uploads and samples are locked. */
  locked?: { onSignIn: () => void; onSignUp: () => void }
  /** The headline block, placed above the upload zone on every screen size. */
  hero?: ReactNode
}

const STEPS = [
  { icon: CloudUpload, title: 'Upload', text: 'A CSV or Excel file, or a sample.' },
  { icon: ScanSearch, title: 'Check quality', text: 'Missing, invalid and duplicate values first.' },
  { icon: ChartColumn, title: 'Analyse', text: 'KPIs and charts, yourself or with the AI analyst.' },
  { icon: Share2, title: 'Share', text: 'PDF, PowerPoint or clean CSV.' },
]

export function Hero({ signInRequired = false }: { signInRequired?: boolean }) {
  return (
    <div className="animate-rise text-center lg:text-left">
      <div className="mb-4 flex flex-wrap justify-center gap-2 lg:justify-start">
        <Badge tone="accent" icon={Sparkles}>
          {signInRequired ? 'Free · Sign in with Google or GitHub' : 'Free · Sign-up optional'}
        </Badge>
        <Badge tone="good" icon={Lock}>
          Files are never stored
        </Badge>
      </div>
      <h1 className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl xl:text-5xl">
        Turn a spreadsheet into a <span className="brand-text">verified dashboard</span>
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-pretty text-base text-ink-2 lg:mx-0">
        Upload a CSV or Excel file to check its quality, get KPIs and charts, or let the AI analyst write a report. Every figure is calculated
        directly from your data.
      </p>
    </div>
  )
}

/** Example dashboard built from the bundled "Retail sales" sample (real figures from that file). Decorative. */
function DashboardPreview() {
  const bars = [
    { label: 'Household', value: 7.27 },
    { label: 'Personal Care', value: 4.62 },
    { label: 'Beverages', value: 2.3 },
    { label: 'Snacks', value: 1.24 },
    { label: 'Stationery', value: 1.03 },
  ]
  const max = bars[0].value
  return (
    <figure
      role="img"
      aria-label="Example dashboard from the Retail sales sample: total revenue ₹16.46 lakh across 725 rows and 5 categories; Household brings in 44.1% of revenue."
      className="animate-rise group overflow-hidden rounded-3xl border border-line bg-surface shadow-float"
      style={{ animationDelay: '60ms' }}
    >
      <div aria-hidden>
        <div className="flex items-center gap-2 border-b border-line bg-surface-2/70 px-4 py-2.5">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="ml-2 truncate text-xs font-medium text-ink-muted">retail_sales.csv · dashboard</span>
          <span className="ml-auto rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted ring-1 ring-line">Example</span>
        </div>
        <div className="grid gap-3 p-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Total revenue', '₹16.46L', true],
              ['Rows analysed', '725', false],
              ['Categories', '5', false],
            ].map(([label, value, lead]) => (
              <div key={label as string} className={`rounded-xl p-2.5 ${lead ? 'gradient-border' : 'border border-line bg-surface'}`}>
                <p className="truncate text-[10px] font-medium text-ink-muted">{label}</p>
                <p className="tabular mt-0.5 text-base font-bold tracking-tight text-ink">{value}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink">Revenue by category</p>
              <span className="flex gap-1 rounded-lg bg-surface-2 p-0.5 text-[10px] font-semibold text-ink-muted ring-1 ring-inset ring-line">
                <span className="rounded-md bg-surface px-1.5 py-0.5 text-ink shadow-soft ring-1 ring-line">Bar</span>
                <span className="px-1.5 py-0.5">Donut</span>
                <span className="px-1.5 py-0.5">Table</span>
              </span>
            </div>
            <div className="mt-3 grid gap-1.5">
              {bars.map((b) => (
                <div key={b.label} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2 text-[11px]">
                  <span className="truncate text-ink-2">{b.label}</span>
                  <span className="h-3 overflow-hidden rounded-r-md bg-surface-2">
                    <span
                      className="block h-full rounded-r-md transition-[filter] group-hover:brightness-110"
                      style={{ width: `${(b.value / max) * 100}%`, background: SERIES[0] }}
                    />
                  </span>
                  <span className="tabular text-right font-semibold text-ink-2">{b.value}L</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-xl bg-accent-soft/70 p-2.5 text-[11px] text-ink-2">
            <Bot className="mt-px size-3.5 shrink-0 text-accent-text" />
            <span>
              <span className="font-semibold text-ink">Household brings in 44.1% of revenue.</span> Every number is checked against its evidence.
            </span>
          </div>
        </div>
      </div>
    </figure>
  )
}

function UploadZone({ config, busy, onFile, locked }: Pick<Props, 'config' | 'busy' | 'onFile' | 'locked'>) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const limits = config?.limits

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file && !busy && !locked) onFile(file)
  }

  return (
    <section className="animate-rise gradient-border rounded-3xl p-2 shadow-float" aria-labelledby="upload-title" style={{ animationDelay: '30ms' }}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`dot-grid relative flex flex-col items-center justify-center gap-4 rounded-[1.25rem] border-2 border-dashed px-5 py-8 text-center transition sm:py-10 ${
          dragging ? 'scale-[0.99] border-accent bg-accent-soft' : 'border-line-strong bg-surface-2/60'
        }`}
      >
        {locked ? (
          <>
            <span className="grid size-14 place-items-center rounded-2xl brand-gradient text-white shadow-[0_12px_28px_-10px_rgb(79_70_229/0.8)]">
              <Lock aria-hidden className="size-7" />
            </span>
            <div>
              <h2 id="upload-title" className="text-xl font-semibold tracking-tight text-ink">
                Sign in to upload your data
              </h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
                Use your Gmail (Google) or GitHub account. It takes a few seconds and there is no password to remember.
              </p>
            </div>
            <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
              <Button variant="primary" size="lg" icon={LogIn} onClick={locked.onSignIn}>
                Sign in to upload
              </Button>
              <Button size="lg" icon={UserRoundPlus} onClick={locked.onSignUp}>
                Create an account
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="grid size-14 place-items-center rounded-2xl brand-gradient text-white shadow-[0_12px_28px_-10px_rgb(79_70_229/0.8)]">
              <CloudUpload aria-hidden className="size-7" />
            </span>
            <div>
              <h2 id="upload-title" className="text-xl font-semibold tracking-tight text-ink">
                {dragging ? 'Drop it here' : 'Drag your CSV or Excel (.xlsx) file here'}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">or pick one from your computer</p>
            </div>
            <Button variant="primary" size="lg" icon={FileSpreadsheet} busy={busy} onClick={() => input.current?.click()} className="w-full sm:w-auto">
              Choose file
            </Button>
            <label htmlFor="file-input" className="sr-only">
              Upload CSV or XLSX file
            </label>
            <input
              id="file-input"
              ref={input}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onFile(file)
                e.target.value = ''
              }}
            />
          </>
        )}
        {limits && (
          <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Upload limits">
            <li>
              <Badge>CSV up to {limits.max_upload_mb} MB</Badge>
            </li>
            <li>
              <Badge>Excel up to {limits.max_xlsx_mb ?? limits.max_upload_mb} MB</Badge>
            </li>
            <li>
              <Badge>{formatCount(limits.max_rows)} rows</Badge>
            </li>
            <li>
              <Badge>{limits.max_columns} columns</Badge>
            </li>
          </ul>
        )}
        <p className="max-w-md text-xs text-ink-muted">
          The first row must contain column names. For Excel files only the first sheet is read, and formulas use their last saved values.
        </p>
      </div>
    </section>
  )
}

function SampleList({ samples, busy, onSample, locked }: Pick<Props, 'samples' | 'busy' | 'onSample' | 'locked'>) {
  return (
    <section className="animate-rise grid content-start gap-2.5" aria-labelledby="samples-title" style={{ animationDelay: '90ms' }}>
      <div className="flex items-center gap-2 px-1">
        <Zap aria-hidden className="size-4 text-accent" />
        <h2 id="samples-title" className="text-sm font-semibold text-ink">
          No file? Try a sample
        </h2>
      </div>
      {samples.length === 0 && (
        <>
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </>
      )}
      {samples.map((sample) => (
        <article
          key={sample.id}
          className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-soft transition hover:border-accent/40 hover:shadow-card"
        >
          <IconChip icon={FileSpreadsheet} tone={sample.file_name.endsWith('.xlsx') ? 'good' : 'accent'} size="sm" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-ink">{sample.title}</h3>
            <p className="line-clamp-2 text-xs leading-snug text-ink-muted" title={sample.description}>
              {sample.description}
            </p>
          </div>
          <Button
            size="sm"
            variant="soft"
            className="shrink-0"
            disabled={busy || !!locked}
            title={locked ? 'Sign in to try a sample' : undefined}
            onClick={() => onSample(sample)}
            aria-label={`Load sample: ${sample.title}`}
          >
            {locked ? 'Sign in to try' : 'Load sample'}
          </Button>
        </article>
      ))}
      <p className="flex items-center gap-1.5 px-1 text-xs text-ink-muted">
        <ShieldCheck aria-hidden className="size-3.5" /> All sample data is synthetic.
      </p>
    </section>
  )
}

export function UploadPanel({ config, samples, busy, onFile, onSample, locked, hero }: Props) {
  return (
    <div className="grid gap-8">
      {/* Desktop: headline + upload (left), example dashboard + samples (right). Phones: headline, upload, samples. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 pt-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10 lg:pt-6">
        <div className="grid min-w-0 gap-6">
          {hero}
          <UploadZone config={config} busy={busy} onFile={onFile} locked={locked} />
        </div>
        <div className="grid min-w-0 gap-5">
          <div className="hidden md:block">
            <DashboardPreview />
          </div>
          <SampleList samples={samples} busy={busy} onSample={onSample} locked={locked} />
        </div>
      </div>

      <section aria-labelledby="how-title" className="animate-rise" style={{ animationDelay: '120ms' }}>
        <h2 id="how-title" className="sr-only">
          How it works
        </h2>
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3 rounded-2xl border border-line bg-surface/70 p-3 backdrop-blur">
              <IconChip icon={step.icon} tone="neutral" size="sm" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink">
                  <span className="text-ink-muted">{i + 1}. </span>
                  {step.title}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="flex items-start justify-center gap-2 text-center text-xs text-ink-muted">
        <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-good" />
        Files are processed in memory for each request and are not stored. This is a demonstration tool: do not upload confidential or regulated
        data.
      </p>
    </div>
  )
}

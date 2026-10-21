import { useRef, useState, type DragEvent } from 'react'
import {
  ChartColumn,
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
import { Badge, Button, IconChip, Skeleton } from './ui'

interface Props {
  config: AppConfig | null
  samples: SampleInfo[]
  busy: boolean
  onFile: (file: File) => void
  onSample: (sample: SampleInfo) => void
  /** Set when the server requires sign-in and nobody is signed in: uploads and samples are locked. */
  locked?: { onSignIn: () => void; onSignUp: () => void }
}

const STEPS = [
  { icon: CloudUpload, title: 'Upload', text: 'Drop a CSV or Excel file, or start with a sample.' },
  { icon: ScanSearch, title: 'Check quality', text: 'See missing, invalid and duplicate values before you trust a number.' },
  { icon: ChartColumn, title: 'Analyse', text: 'Pick a measure and a grouping: KPIs and charts appear instantly.' },
  { icon: Share2, title: 'Share', text: 'Download clean CSVs or print a ready-made management report.' },
]

export function Hero({ signInRequired = false }: { signInRequired?: boolean }) {
  return (
    <div className="animate-rise mx-auto max-w-3xl py-6 text-center sm:py-10">
      <div className="mb-5 flex flex-wrap justify-center gap-2">
        <Badge tone="accent" icon={Sparkles}>
          {signInRequired ? 'Free · Sign in with Google or GitHub' : 'Free · Sign-up optional'}
        </Badge>
        <Badge tone="good" icon={Lock}>
          Files are never stored
        </Badge>
      </div>
      <h1 className="text-balance text-4xl font-bold tracking-tight text-ink sm:text-5xl">
        Turn a spreadsheet into a <span className="brand-text">clear business dashboard</span>
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-pretty text-base text-ink-2 sm:text-lg">
        Upload a CSV or Excel file to check its quality, calculate KPIs, explore charts and download a report. Every figure is calculated
        directly from your data.
      </p>
    </div>
  )
}

export function UploadPanel({ config, samples, busy, onFile, onSample, locked }: Props) {
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
    <div className="grid gap-8">
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className="animate-rise gradient-border rounded-3xl p-2 shadow-float" aria-labelledby="upload-title">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`dot-grid relative flex h-full flex-col items-center justify-center gap-4 rounded-[1.25rem] border-2 border-dashed px-6 py-12 text-center transition ${
              dragging ? 'scale-[0.99] border-accent bg-accent-soft' : 'border-line-strong bg-surface-2/60'
            }`}
          >
            {locked ? (
              <>
                <span className="grid size-16 place-items-center rounded-2xl brand-gradient text-white shadow-[0_12px_28px_-10px_rgb(79_70_229/0.8)]">
                  <Lock aria-hidden className="size-8" />
                </span>
                <div>
                  <h2 id="upload-title" className="text-xl font-semibold tracking-tight text-ink">
                    Sign in to upload your data
                  </h2>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
                    Use your Gmail (Google) or GitHub account. It takes a few seconds and there is no password to remember.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-3">
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
                <span className="grid size-16 place-items-center rounded-2xl brand-gradient text-white shadow-[0_12px_28px_-10px_rgb(79_70_229/0.8)]">
                  <CloudUpload aria-hidden className="size-8" />
                </span>
                <div>
                  <h2 id="upload-title" className="text-xl font-semibold tracking-tight text-ink">
                    {dragging ? 'Drop it here' : 'Drag your CSV or Excel (.xlsx) file here'}
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">or pick one from your computer</p>
                </div>
                <Button variant="primary" size="lg" icon={FileSpreadsheet} busy={busy} onClick={() => input.current?.click()}>
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
              <ul className="flex flex-wrap justify-center gap-2" aria-label="Upload limits">
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
                <li>
                  <Badge>.csv · .xlsx</Badge>
                </li>
              </ul>
            )}
            <p className="max-w-md text-xs text-ink-muted">
              The first row must contain column names. For Excel files only the first sheet is read, and formulas use their last saved values.
            </p>
          </div>
        </section>

        <section className="animate-rise grid content-start gap-3" aria-labelledby="samples-title" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center gap-2 px-1">
            <Zap aria-hidden className="size-4 text-accent" />
            <h2 id="samples-title" className="text-sm font-semibold text-ink">
              No file? Try a sample
            </h2>
          </div>
          {samples.length === 0 && (
            <>
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </>
          )}
          {samples.map((sample) => (
            <article
              key={sample.id}
              className="group flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card"
            >
              <IconChip icon={FileSpreadsheet} tone={sample.file_name.endsWith('.xlsx') ? 'good' : 'accent'} />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-ink">{sample.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">{sample.description}</p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="soft"
                  disabled={busy || !!locked}
                  title={locked ? 'Sign in to try a sample' : undefined}
                  onClick={() => onSample(sample)}
                  aria-label={`Load sample: ${sample.title}`}
                >
                  {locked ? 'Sign in to try' : 'Load sample'}
                </Button>
              </div>
            </article>
          ))}
          <p className="flex items-center gap-1.5 px-1 text-xs text-ink-muted">
            <ShieldCheck aria-hidden className="size-3.5" /> All sample data is synthetic.
          </p>
        </section>
      </div>

      <section aria-labelledby="how-title" className="animate-rise" style={{ animationDelay: '120ms' }}>
        <h2 id="how-title" className="sr-only">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative rounded-2xl border border-line bg-surface/70 p-4 backdrop-blur">
              <div className="flex items-center gap-3">
                <IconChip icon={step.icon} tone="neutral" size="sm" />
                <span className="text-xs font-semibold text-ink-muted">Step {i + 1}</span>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-ink">{step.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <p className="flex items-start justify-center gap-2 text-center text-xs text-ink-muted">
        <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
        Files are processed in memory for each request and are not stored. This is a demonstration tool: do not upload confidential or
        regulated data.
      </p>
    </div>
  )
}

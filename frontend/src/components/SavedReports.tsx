import { useState } from 'react'
import { ArrowLeft, BookmarkCheck, FileSpreadsheet, FolderOpen, LogIn, Printer, Save, Trash2, UploadCloud } from 'lucide-react'
import { LOCALE, formatCount } from '../lib/format'
import type { ChartKind } from '../lib/charts'
import type { ReportSummary, SavedReport } from '../lib/types'
import { ReportView } from './ReportView'
import { Alert, Badge, Button, Card, IconChip, Skeleton, Spinner, labelClass } from './ui'

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

interface ListProps {
  reports: ReportSummary[] | null
  error: string | null
  onOpen: (id: string) => void
  onDelete: (id: string) => Promise<void>
  onNew: () => void
}

/** "My reports": the signed-in user's saved reports, newest first. */
export function ReportsList({ reports, error, onOpen, onDelete, onNew }: ListProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function remove(id: string) {
    setDeleting(id)
    try {
      await onDelete(id)
    } finally {
      setDeleting(null)
      setConfirming(null)
    }
  }

  return (
    <Card
      title="My reports"
      subtitle="Saved analyses with their figures, charts and data-quality notes. Only you can see them."
      icon={FolderOpen}
      actions={
        <Button variant="primary" size="sm" icon={UploadCloud} onClick={onNew}>
          New analysis
        </Button>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {!reports && !error && (
        <div className="grid gap-3">
          <Spinner label="Loading your reports…" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}
      {reports?.length === 0 && (
        <div className="dot-grid grid place-items-center rounded-2xl border-2 border-dashed border-line-strong p-10 text-center">
          <IconChip icon={BookmarkCheck} tone="brand" size="lg" />
          <h3 className="mt-4 text-base font-semibold text-ink">No saved reports yet</h3>
          <p className="mt-1 max-w-sm text-sm text-ink-2">
            Analyse a file, then choose <strong>Save report</strong> on the Report &amp; export step.
          </p>
        </div>
      )}
      {reports && reports.length > 0 && (
        <ul aria-label="Saved reports" className="grid gap-2">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 transition hover:border-accent/40 hover:bg-surface-2">
              <IconChip icon={FileSpreadsheet} size="sm" />
              <button type="button" onClick={() => onOpen(r.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-semibold text-ink">{r.title}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {r.source_name} · {formatCount(r.row_count)} rows · {formatDate(r.created_at)}
                </span>
              </button>
              <Badge>{r.source_type.toUpperCase()}</Badge>
              {confirming === r.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-ink-2">Delete permanently?</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                  <Button size="sm" icon={Trash2} busy={deleting === r.id} onClick={() => remove(r.id)} aria-label={`Confirm delete ${r.title}`}>
                    Delete
                  </Button>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Button size="sm" variant="soft" onClick={() => onOpen(r.id)} aria-label={`Open ${r.title}`}>
                    Open
                  </Button>
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirming(r.id)} aria-label={`Delete ${r.title}`} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** A saved report, rendered from the stored results (no file needed). */
export function SavedReportPage({ report, onBack }: { report: SavedReport; onBack: () => void }) {
  const chartKind: ChartKind = report.result.chart.recommended === 'line' ? 'line' : 'bar'
  return (
    <div className="animate-rise grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          Back to my reports
        </Button>
        <Button variant="primary" icon={Printer} onClick={() => window.print()}>
          Print / save as PDF
        </Button>
      </div>
      <div className="print:hidden">
        <Alert kind="info" title={`Saved ${formatDate(report.created_at)}`}>
          Figures were calculated when the report was saved. To change the analysis or download CSVs, upload {report.source_name} again.
        </Alert>
      </div>
      <ReportView
        dataset={report.quality.dataset}
        issues={report.quality.issues}
        result={report.result}
        narrative={report.narrative}
        chartKind={chartKind}
        measureKey={report.result.measures[0]?.key ?? ''}
        preparedAt={new Date(report.created_at)}
      />
    </div>
  )
}

interface SaveProps {
  signedIn: boolean
  available: boolean
  defaultTitle: string
  hasNarrative: boolean
  onSave: (title: string) => Promise<void>
  onSignIn: () => void
}

/** Report step: keep this analysis in "My reports". Re-mount (key) it for a new analysis. */
export function SaveReportCard({ signedIn, available, defaultTitle, hasNarrative, onSave, onSignIn }: SaveProps) {
  const [title, setTitle] = useState(defaultTitle)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!available) return null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave(title)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The report could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card print:hidden" aria-labelledby="save-title">
      <div className="flex items-start gap-3">
        <IconChip icon={Save} />
        <div className="min-w-0">
          <h2 id="save-title" className="text-base font-semibold tracking-tight text-ink">
            Save report
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Keeps the figures, chart data and quality notes{hasNarrative ? ' and AI commentary' : ''} in your account. Your file and its rows are not
            stored.
          </p>
        </div>
      </div>
      {signedIn ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor="report-title" className={labelClass}>
              Report title
            </label>
            <input
              id="report-title"
              value={title}
              maxLength={200}
              onChange={(e) => {
                setTitle(e.target.value)
                setSaved(false)
              }}
              className="min-h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink shadow-soft transition hover:border-accent/50 focus:border-accent"
            />
          </div>
          <Button variant="primary" icon={saved ? BookmarkCheck : Save} busy={busy} disabled={!title.trim() || saved} onClick={save}>
            {saved ? 'Saved' : 'Save to my reports'}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={LogIn} onClick={onSignIn}>
            Sign in to save
          </Button>
          <span className="text-xs text-ink-muted">Free with Google or GitHub.</span>
        </div>
      )}
      {saved && (
        <div className="mt-3">
          <Alert kind="success">Saved. Find it any time under My reports.</Alert>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      )}
    </section>
  )
}

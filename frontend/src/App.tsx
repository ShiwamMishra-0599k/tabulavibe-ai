import { useEffect, useState } from 'react'
import { AiNarrative } from './components/AiNarrative'
import { AnalysisBuilder } from './components/AnalysisBuilder'
import { Dashboard } from './components/Dashboard'
import type { ChartKind } from './lib/charts'
import { DataPreview } from './components/DataPreview'
import { QualityReport } from './components/QualityReport'
import { ReportView } from './components/ReportView'
import { Alert, Button, Spinner } from './components/ui'
import { UploadPanel } from './components/UploadPanel'
import { api, ApiError, saveBlob } from './lib/api'
import { formatCount } from './lib/format'
import { defaultSpec } from './lib/spec'
import type { AnalysisResult, AnalysisSpec, AppConfig, Narrative, Profile, SampleInfo } from './lib/types'

type Tab = 'preview' | 'quality' | 'analyze' | 'report'
const TABS: { id: Tab; label: string }[] = [
  { id: 'preview', label: '1. Preview' },
  { id: 'quality', label: '2. Data quality' },
  { id: 'analyze', label: '3. Analyse' },
  { id: 'report', label: '4. Report & export' },
]

function message(error: unknown): string {
  if (error instanceof ApiError) return error.details.length ? `${error.message} (${error.details.join('; ')})` : error.message
  return 'Something unexpected went wrong. Please try again.'
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [samples, setSamples] = useState<SampleInfo[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [spec, setSpec] = useState<AnalysisSpec | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [analysedAt, setAnalysedAt] = useState(() => new Date())
  const [narrative, setNarrative] = useState<Narrative | null>(null)
  const [tab, setTab] = useState<Tab>('preview')
  const [chartKind, setChartKind] = useState<ChartKind>('bar')
  const [measureKey, setMeasureKey] = useState('')

  const [busy, setBusy] = useState<null | 'upload' | 'analyze' | 'export-clean' | 'export-results' | 'narrative'>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [exportDedupe, setExportDedupe] = useState(false)
  const [exportMerge, setExportMerge] = useState(false)

  useEffect(() => {
    Promise.all([api.config(), api.samples()])
      .then(([cfg, list]) => {
        setConfig(cfg)
        setSamples(list)
      })
      .catch((e) => setServerError(message(e)))
  }, [])

  function reset() {
    setFile(null)
    setProfile(null)
    setSpec(null)
    setResult(null)
    setNarrative(null)
    setError(null)
    setAiError(null)
    setExportNotice(null)
  }

  async function loadFile(next: File) {
    reset()
    const limitMb = config?.limits.max_upload_mb
    if (limitMb && next.size > limitMb * 1024 * 1024) {
      setError(`"${next.name}" is larger than the ${limitMb} MB limit.`)
      return
    }
    if (!/\.(csv|xlsx)$/i.test(next.name)) {
      setError(`"${next.name}" is not a supported file. Upload a .csv or .xlsx file.`)
      return
    }
    setBusy('upload')
    try {
      const p = await api.profile(next)
      setFile(next)
      setProfile(p)
      setSpec(defaultSpec(p))
      setTab('preview')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  async function loadSample(sample: SampleInfo) {
    setError(null)
    setBusy('upload')
    try {
      const sampleFile = await api.sampleFile(sample)
      setBusy(null)
      await loadFile(sampleFile)
    } catch (e) {
      setError(message(e))
      setBusy(null)
    }
  }

  async function runAnalysis() {
    if (!file || !spec) return
    setBusy('analyze')
    setError(null)
    setNarrative(null)
    setAiError(null)
    try {
      const r = await api.analyze(file, spec)
      setResult(r)
      setAnalysedAt(new Date())
      setMeasureKey(r.measures[0]?.key ?? '')
      setChartKind(r.chart.recommended === 'line' ? 'line' : 'bar')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  async function exportCleaned() {
    if (!file) return
    setBusy('export-clean')
    setExportNotice(null)
    try {
      const out = await api.exportCleaned(file, exportDedupe, exportMerge)
      saveBlob(out.blob, out.filename)
      setExportNotice(
        `Downloaded ${formatCount(Number(out.headers.get('X-Rows-Exported') ?? 0))} rows` +
          (exportDedupe ? `; ${out.headers.get('X-Duplicates-Removed') ?? 0} duplicate row(s) removed` : '') +
          (exportMerge ? `; ${out.headers.get('X-Labels-Merged') ?? 0} label(s) merged` : '') +
          '.',
      )
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  async function exportResults() {
    if (!file || !result) return
    setBusy('export-results')
    try {
      const out = await api.exportResults(file, result.spec)
      saveBlob(out.blob, out.filename)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  async function generateNarrative() {
    if (!file || !result) return
    setBusy('narrative')
    setAiError(null)
    try {
      setNarrative(await api.narrative(file, result.spec))
    } catch (e) {
      setAiError(message(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-ink">
              TV
            </span>
            <div>
              <p className="text-base font-semibold leading-tight text-ink">TabulaVibe AI</p>
              <p className="text-xs text-ink-muted">Spreadsheets to dashboards and reports</p>
            </div>
          </div>
          {profile && (
            <div className="flex min-w-0 items-center gap-3">
              <p className="min-w-0 truncate text-sm text-ink-2" title={profile.dataset.file_name}>
                <span className="font-medium text-ink">{profile.dataset.file_name}</span> · {formatCount(profile.dataset.row_count)} rows
              </p>
              <Button onClick={reset}>New file</Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-6">
        {serverError && (
          <Alert kind="error" title="The server is unavailable">
            {serverError}
          </Alert>
        )}
        {error && (
          <div className="print:hidden">
            <Alert kind="error" title="That didn't work">
              {error}
            </Alert>
          </div>
        )}

        {!profile && (
          <>
            <div className="py-2">
              <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Turn a spreadsheet into a clear business dashboard</h1>
              <p className="mt-2 max-w-2xl text-ink-2">
                Upload a CSV or Excel file to check its quality, calculate KPIs, explore charts and download a report. Every figure is
                calculated directly from your data.
              </p>
            </div>
            {busy === 'upload' ? (
              <div className="rounded-xl border border-line bg-surface p-10 text-center">
                <Spinner label="Reading and checking your file…" />
              </div>
            ) : (
              <UploadPanel config={config} samples={samples} busy={busy !== null} onFile={loadFile} onSample={loadSample} />
            )}
          </>
        )}

        {profile && spec && (
          <>
            <nav aria-label="Workflow steps" className="overflow-x-auto print:hidden">
              <div role="tablist" className="flex min-w-max gap-1 rounded-xl border border-line bg-surface p-1">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={tab === t.id}
                    aria-controls={`panel-${t.id}`}
                    disabled={t.id === 'report' && !result}
                    onClick={() => setTab(t.id)}
                    className={`min-h-10 rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                      tab === t.id ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-surface-2'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </nav>

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'preview' && (
                <div className="grid gap-4">
                  <DataPreview profile={profile} />
                  <div className="flex justify-end">
                    <Button variant="primary" onClick={() => setTab('quality')}>
                      Next: check data quality
                    </Button>
                  </div>
                </div>
              )}
              {tab === 'quality' && (
                <div className="grid gap-4">
                  <QualityReport profile={profile} />
                  <div className="flex justify-end">
                    <Button variant="primary" onClick={() => setTab('analyze')}>
                      Next: analyse
                    </Button>
                  </div>
                </div>
              )}
              {tab === 'analyze' && (
                <div className="grid items-start gap-4 lg:grid-cols-[380px_1fr]">
                  <AnalysisBuilder profile={profile} spec={spec} onChange={setSpec} onRun={runAnalysis} busy={busy === 'analyze'} />
                  <div className="grid gap-4">
                    {busy === 'analyze' && <Spinner label="Calculating…" />}
                    {!result && busy !== 'analyze' && (
                      <div className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-2">
                        Choose your measures and grouping, then select <strong>Run analysis</strong>. A starting point has been suggested
                        from your columns.
                      </div>
                    )}
                    {result && (
                      <>
                        <Dashboard
                          result={result}
                          chartKind={chartKind}
                          measureKey={measureKey}
                          onChartKind={setChartKind}
                          onMeasureKey={setMeasureKey}
                        />
                        <AiNarrative config={config} narrative={narrative} error={aiError} busy={busy === 'narrative'} onGenerate={generateNarrative} />
                        <div className="flex justify-end">
                          <Button variant="primary" onClick={() => setTab('report')}>
                            Next: report & export
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              {tab === 'report' && result && (
                <div className="grid gap-4">
                  <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 print:hidden">
                    <h2 className="text-base font-semibold text-ink">Downloads</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="primary" onClick={() => window.print()}>
                        Print / save as PDF
                      </Button>
                      <Button busy={busy === 'export-results'} onClick={exportResults}>
                        Download results (CSV)
                      </Button>
                      <Button busy={busy === 'export-clean'} onClick={exportCleaned}>
                        Download cleaned data (CSV)
                      </Button>
                      <label className="flex items-center gap-2 text-sm text-ink-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--accent)]"
                          checked={exportDedupe}
                          onChange={(e) => setExportDedupe(e.target.checked)}
                        />
                        Remove duplicate rows from cleaned data
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--accent)]"
                          checked={exportMerge}
                          onChange={(e) => setExportMerge(e.target.checked)}
                        />
                        Merge case/spacing label variants
                      </label>
                    </div>
                    <p className="text-xs text-ink-muted">
                      Cleaned data standardises numbers (e.g. ₹1,200 → 1200), dates (YYYY-MM-DD) and yes/no values. Missing values stay
                      empty and invalid values are kept exactly as uploaded. Text that a spreadsheet could run as a formula is prefixed with
                      an apostrophe.
                    </p>
                    {exportNotice && <Alert kind="success">{exportNotice}</Alert>}
                  </div>
                  <ReportView profile={profile} result={result} narrative={narrative} chartKind={chartKind} measureKey={measureKey} preparedAt={analysedAt} />
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-ink-muted print:hidden">
        TabulaVibe AI is a demonstration tool. Uploaded files are processed in memory and not stored. Sample data is synthetic.
      </footer>
    </div>
  )
}

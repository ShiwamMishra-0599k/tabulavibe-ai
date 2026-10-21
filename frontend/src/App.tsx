import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ChartColumn,
  ChartNoAxesColumn,
  Check,
  Eye,
  FileDown,
  FileSpreadsheet,
  FolderOpen,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Printer,
  RotateCcw,
  Stethoscope,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { AiNarrative } from './components/AiNarrative'
import { AnalysisBuilder } from './components/AnalysisBuilder'
import { SignUpPage } from './components/SignUpPage'
import { Dashboard } from './components/Dashboard'
import { DataPreview } from './components/DataPreview'
import { GitHubStars } from './components/GitHubStars'
import { QualityReport } from './components/QualityReport'
import { ReportView } from './components/ReportView'
import { ReportsList, SavedReportPage, SaveReportCard } from './components/SavedReports'
import { SignInDialog } from './components/SignInDialog'
import { Alert, Button, IconChip, Skeleton, Spinner, Toggle } from './components/ui'
import { Hero, UploadPanel } from './components/UploadPanel'
import { api, ApiError, saveBlob } from './lib/api'
import { useAuth, type Auth } from './lib/auth'
import { chartTitle, type ChartKind } from './lib/charts'
import { formatCount } from './lib/format'
import { defaultSpec } from './lib/spec'
import { useTheme, type ThemeChoice } from './lib/theme'
import type { Account, AnalysisResult, AnalysisSpec, AppConfig, Narrative, Profile, ReportSummary, SampleInfo, SavedReport } from './lib/types'

type Tab = 'preview' | 'quality' | 'analyze' | 'report'
type View = 'workspace' | 'sign-up' | 'reports' | 'saved'
const ORDER: Tab[] = ['preview', 'quality', 'analyze', 'report']

function message(error: unknown): string {
  if (error instanceof ApiError) return error.details.length ? `${error.message} (${error.details.join('; ')})` : error.message
  return 'Something unexpected went wrong. Please try again.'
}

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'system', label: 'System theme', icon: Monitor },
  { value: 'dark', label: 'Dark theme', icon: Moon },
]

function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  return (
    <div role="group" aria-label="Colour theme" className="flex rounded-xl bg-surface-2 p-1 ring-1 ring-inset ring-line">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          title={label}
          onClick={() => setTheme(value)}
          className={`grid size-8 place-items-center rounded-lg transition ${theme === value ? 'bg-surface text-accent shadow-soft ring-1 ring-line' : 'text-ink-muted hover:text-ink'}`}
        >
          <Icon aria-hidden className="size-4" />
        </button>
      ))}
    </div>
  )
}

function AccountMenu({ auth, account, onReports, onSignOut }: { auth: Auth; account: Account | null; onReports: () => void; onSignOut: () => void }) {
  if (auth.state.status !== 'signed-in') return null
  const user = auth.state.session.user
  const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>
  const name = account?.full_name || meta.full_name || meta.name || user.email || 'Account'
  const avatar = account?.avatar_url || meta.avatar_url
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="soft" icon={FolderOpen} onClick={onReports}>
        My reports
      </Button>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface py-1 pl-1 pr-1 lg:pr-2" title={user.email ?? undefined}>
        {avatar ? (
          <img src={avatar} alt="" referrerPolicy="no-referrer" className="size-7 rounded-lg object-cover" />
        ) : (
          <span aria-hidden className="grid size-7 place-items-center rounded-lg brand-gradient text-xs font-bold text-white">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-32 truncate text-sm font-medium text-ink lg:block">{name}</span>
        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          title="Sign out"
          className="grid size-7 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-2 hover:text-ink"
        >
          <LogOut aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  )
}

function NextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <Button variant="primary" onClick={onClick}>
        {children}
        <ArrowRight aria-hidden className="size-4" />
      </Button>
    </div>
  )
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
  const [signInOpen, setSignInOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('preview')
  const [chartKind, setChartKind] = useState<ChartKind>('bar')
  const [measureKey, setMeasureKey] = useState('')

  const [busy, setBusy] = useState<null | 'upload' | 'analyze' | 'export-clean' | 'export-results' | 'narrative'>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [exportDedupe, setExportDedupe] = useState(false)
  const [exportMerge, setExportMerge] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)

  const auth = useAuth(config)
  const signedIn = auth.state.status === 'signed-in'
  const storageOn = !!config?.storage?.enabled && auth.state.status !== 'disabled'
  const [requestedView, setView] = useState<View>('workspace')
  const [accountState, setAccountState] = useState<{ userId: string; account: Account } | null>(null)
  const [reports, setReports] = useState<ReportSummary[] | null>(null)
  const [reportsError, setReportsError] = useState<string | null>(null)
  const [savedReport, setSavedReport] = useState<SavedReport | null>(null)

  useEffect(() => {
    Promise.all([api.config(), api.samples()])
      .then(([cfg, list]) => {
        setConfig(cfg)
        setSamples(list)
      })
      .catch((e) => setServerError(message(e)))
  }, [])

  // Once signed in, the sign-up page is never shown; the TabulaVibe profile feeds the header.
  const view: View = requestedView === 'sign-up' && signedIn ? 'workspace' : requestedView
  const userId = auth.state.status === 'signed-in' ? auth.state.session.user.id : null
  const account = accountState && accountState.userId === userId ? accountState.account : null
  const { token } = auth
  useEffect(() => {
    if (!userId) return
    token()
      .then((t) => api.account(t))
      .then((a) => setAccountState({ userId, account: a }))
      .catch(() => undefined) // the header falls back to the provider's name and picture
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  function openSignUp() {
    setSignInOpen(false)
    setView('sign-up')
    window.scrollTo({ top: 0 })
  }

  async function openReports() {
    setView('reports')
    setSavedReport(null)
    setReports(null)
    setReportsError(null)
    window.scrollTo({ top: 0 })
    try {
      setReports(await api.listReports(await auth.token()))
    } catch (e) {
      setReportsError(message(e))
    }
  }

  async function openReport(id: string) {
    setReportsError(null)
    try {
      setSavedReport(await api.getReport(await auth.token(), id))
      setView('saved')
      window.scrollTo({ top: 0 })
    } catch (e) {
      setReportsError(message(e))
    }
  }

  async function deleteReport(id: string) {
    try {
      await api.deleteReport(await auth.token(), id)
      setReports((list) => list?.filter((r) => r.id !== id) ?? null)
    } catch (e) {
      setReportsError(message(e))
    }
  }

  async function saveReport(title: string) {
    if (!file || !result) return
    try {
      await api.saveReport(await auth.token(), file, result.spec, title.trim(), narrative)
    } catch (e) {
      throw new Error(message(e))
    }
  }

  async function signOut() {
    await auth.signOut()
    setReports(null)
    setSavedReport(null)
    setView('workspace')
  }

  function goTo(next: Tab) {
    setTab(next)
    window.scrollTo({ top: 0 })
  }

  function reset() {
    setView('workspace')
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
      goTo('preview')
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

  async function runAnalysis(override?: AnalysisSpec) {
    const toRun = override ?? spec
    if (!file || !toRun) return
    setBusy('analyze')
    setError(null)
    setNarrative(null)
    setAiError(null)
    try {
      const r = await api.analyze(file, toRun)
      setResult(r)
      setAnalysedAt(new Date())
      setMeasureKey(r.measures[0]?.key ?? '')
      setChartKind(r.chart.recommended === 'line' ? 'line' : 'bar')
      // On narrow screens the results sit below the builder: bring them into view.
      if (window.matchMedia?.('(max-width: 1023px)').matches) {
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ block: 'start' }))
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  function applySuggestion(next: AnalysisSpec) {
    setSpec(next)
    void runAnalysis(next)
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

  const steps: { id: Tab; label: string; hint: string; icon: LucideIcon; disabled?: boolean }[] = profile
    ? [
        { id: 'preview', label: 'Preview', hint: `${formatCount(profile.dataset.row_count)} rows · ${profile.dataset.column_count} columns`, icon: Eye },
        { id: 'quality', label: 'Data quality', hint: `${profile.dataset.valid_cell_pct}% healthy`, icon: Stethoscope },
        { id: 'analyze', label: 'Analyse', hint: result ? `${result.kpis.length} KPI(s) ready` : 'Build KPIs and charts', icon: ChartColumn },
        { id: 'report', label: 'Report & export', hint: result ? 'Print and download' : 'Run an analysis first', icon: FileDown, disabled: !result },
      ]
    : []
  const isDone = (id: Tab) => ORDER.indexOf(id) < ORDER.indexOf(tab) || (id === 'analyze' && !!result && tab !== 'analyze')

  return (
    <div className="min-h-screen">
      <header className="sticky top-3 z-30 mx-auto w-[calc(100%-2rem)] max-w-7xl print:hidden">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 rounded-[2rem] border border-line bg-glass px-4 py-2 shadow-float backdrop-blur-xl sm:px-5">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 place-items-center rounded-xl brand-gradient text-white shadow-[0_8px_20px_-8px_rgb(79_70_229/0.8)]">
              <ChartNoAxesColumn className="size-5" />
            </span>
            <div>
              <p className="text-base font-bold leading-tight tracking-tight text-ink">
                TabulaVibe <span className="brand-text">AI</span>
              </p>
              <p className="hidden text-xs text-ink-muted sm:block">Spreadsheets to dashboards and reports</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {profile && (
              <>
                <div className="hidden min-w-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 md:flex" title={profile.dataset.file_name}>
                  <FileSpreadsheet aria-hidden className="size-4 shrink-0 text-accent" />
                  <span className="max-w-48 truncate text-sm font-medium text-ink">{profile.dataset.file_name}</span>
                  <span className="text-xs text-ink-muted">· {formatCount(profile.dataset.row_count)} rows</span>
                </div>
                <Button size="sm" icon={RotateCcw} onClick={reset}>
                  New file
                </Button>
              </>
            )}
            {!signedIn && (
              <>
                <Button size="sm" variant="secondary" icon={LogIn} onClick={() => setSignInOpen(true)}>
                  Sign in
                </Button>
                {storageOn && (
                  <Button size="sm" variant="primary" className="hidden sm:inline-flex" onClick={openSignUp}>
                    Sign up
                  </Button>
                )}
              </>
            )}
            <AccountMenu auth={auth} account={account} onReports={openReports} onSignOut={signOut} />
            <GitHubStars />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <SignInDialog
        open={signInOpen && !signedIn}
        onClose={() => setSignInOpen(false)}
        onSignIn={storageOn ? auth.signIn : undefined}
        onCreateAccount={storageOn ? openSignUp : undefined}
        hasOpenWork={!!profile}
      />

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:py-8">
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

        {view === 'sign-up' && (
          <SignUpPage onSignUp={auth.signIn} onSignInInstead={() => setSignInOpen(true)} onBack={() => setView('workspace')} hasOpenWork={!!profile} />
        )}
        {view === 'reports' && <ReportsList reports={reports} error={reportsError} onOpen={openReport} onDelete={deleteReport} onNew={reset} />}
        {view === 'saved' && savedReport && <SavedReportPage report={savedReport} onBack={openReports} />}

        {view === 'workspace' && !profile && (
          <>
            <Hero />
            {busy === 'upload' ? (
              <div className="grid gap-4 rounded-3xl border border-line bg-surface p-8 shadow-card">
                <Spinner label="Reading and checking your file…" />
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-40" />
                <div className="grid grid-cols-4 gap-3">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              </div>
            ) : (
              <UploadPanel config={config} samples={samples} busy={busy !== null} onFile={loadFile} onSample={loadSample} />
            )}
          </>
        )}

        {view === 'workspace' && profile && spec && (
          <div className="grid gap-6">
            <nav aria-label="Workflow steps" className="print:hidden">
              <div role="tablist" className="grid grid-cols-4 gap-2 sm:gap-3">
                {steps.map((step, i) => {
                  const active = tab === step.id
                  const done = isDone(step.id)
                  return (
                    <button
                      key={step.id}
                      role="tab"
                      id={`tab-${step.id}`}
                      aria-label={`${i + 1}. ${step.label}`}
                      aria-selected={active}
                      aria-controls={`panel-${step.id}`}
                      disabled={step.disabled}
                      onClick={() => goTo(step.id)}
                      className={`relative flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border p-2 text-center transition disabled:cursor-not-allowed disabled:opacity-45 md:flex-row md:gap-3 md:p-3 md:text-left ${
                        active ? 'border-transparent bg-surface shadow-card ring-2 ring-accent/60' : 'border-line bg-surface/60 hover:border-line-strong hover:bg-surface'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`grid size-9 shrink-0 place-items-center rounded-xl transition ${
                          active ? 'brand-gradient text-white' : done ? 'bg-good-soft text-good' : 'bg-surface-2 text-ink-muted'
                        }`}
                      >
                        {done && !active ? <Check className="size-4" /> : <step.icon className="size-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-[11px] font-semibold leading-tight sm:text-xs md:text-sm ${active ? 'text-ink' : 'text-ink-2'}`}>
                          <span className="hidden text-ink-muted md:inline">{i + 1}. </span>
                          {step.label}
                        </span>
                        <span className="hidden truncate text-xs text-ink-muted md:block">{step.hint}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </nav>

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0">
              {tab === 'preview' && (
                <div className="animate-rise grid gap-4">
                  <DataPreview profile={profile} />
                  <NextButton onClick={() => goTo('quality')}>Next: check data quality</NextButton>
                </div>
              )}
              {tab === 'quality' && (
                <div className="grid gap-4">
                  <QualityReport profile={profile} />
                  <NextButton onClick={() => goTo('analyze')}>Next: analyse</NextButton>
                </div>
              )}
              {tab === 'analyze' && (
                <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
                  <AnalysisBuilder
                    profile={profile}
                    spec={spec}
                    onChange={setSpec}
                    onRun={() => runAnalysis()}
                    onApplySuggestion={applySuggestion}
                    busy={busy === 'analyze'}
                  />
                  <div ref={resultsRef} className="grid min-w-0 scroll-mt-4 gap-4 sm:scroll-mt-24">
                    {busy === 'analyze' && (
                      <div className="grid gap-4">
                        <Spinner label="Calculating…" />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Skeleton className="h-36" />
                          <Skeleton className="h-36" />
                        </div>
                        <Skeleton className="h-80" />
                      </div>
                    )}
                    {!result && busy !== 'analyze' && (
                      <div className="dot-grid grid place-items-center rounded-3xl border-2 border-dashed border-line-strong p-10 text-center">
                        <IconChip icon={ChartColumn} tone="brand" size="lg" />
                        <h2 className="mt-4 text-lg font-semibold tracking-tight text-ink">Your dashboard will appear here</h2>
                        <p className="mt-1 max-w-sm text-sm text-ink-2">
                          Pick a suggestion, or choose your measures and grouping, then select <strong>Run analysis</strong>.
                        </p>
                      </div>
                    )}
                    {result && busy !== 'analyze' && (
                      <>
                        <Dashboard result={result} chartKind={chartKind} measureKey={measureKey} onChartKind={setChartKind} onMeasureKey={setMeasureKey} />
                        <AiNarrative config={config} narrative={narrative} error={aiError} busy={busy === 'narrative'} onGenerate={generateNarrative} />
                        <NextButton onClick={() => goTo('report')}>Next: report & export</NextButton>
                      </>
                    )}
                  </div>
                </div>
              )}
              {tab === 'report' && result && (
                <div className="animate-rise grid gap-5">
                  <section className="rounded-2xl border border-line bg-surface p-5 shadow-card print:hidden" aria-labelledby="downloads-title">
                    <h2 id="downloads-title" className="text-base font-semibold tracking-tight text-ink">
                      Downloads
                    </h2>
                    <p className="mt-0.5 text-sm text-ink-muted">Everything below matches the numbers in your dashboard.</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <Button variant="primary" size="lg" icon={Printer} onClick={() => window.print()}>
                        Print / save as PDF
                      </Button>
                      <Button size="lg" icon={FileDown} busy={busy === 'export-results'} onClick={exportResults}>
                        Download results (CSV)
                      </Button>
                      <Button size="lg" icon={FileSpreadsheet} busy={busy === 'export-clean'} onClick={exportCleaned}>
                        Download cleaned data (CSV)
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      <Toggle checked={exportDedupe} onChange={setExportDedupe} label="Remove duplicate rows from cleaned data" />
                      <Toggle checked={exportMerge} onChange={setExportMerge} label="Merge case/spacing label variants" />
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                      Cleaned data standardises numbers (e.g. ₹1,200 → 1200), dates (YYYY-MM-DD) and yes/no values. Missing values stay empty and
                      invalid values are kept exactly as uploaded. Text that a spreadsheet could run as a formula is prefixed with an apostrophe.
                    </p>
                    {exportNotice && (
                      <div className="mt-3">
                        <Alert kind="success">{exportNotice}</Alert>
                      </div>
                    )}
                  </section>
                  <SaveReportCard
                    key={`${analysedAt.getTime()}-${measureKey}`}
                    available={storageOn}
                    signedIn={signedIn}
                    defaultTitle={chartTitle(result, measureKey)}
                    hasNarrative={!!narrative}
                    onSave={saveReport}
                    onSignIn={() => setSignInOpen(true)}
                  />
                  <ReportView dataset={profile.dataset} issues={profile.issues} result={result} narrative={narrative} chartKind={chartKind} measureKey={measureKey} preparedAt={analysedAt} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-center text-xs text-ink-muted print:hidden">
        TabulaVibe AI is a demonstration tool. Uploaded files are processed in memory and never stored; only reports you choose to save are kept in
        your account. Sample data is synthetic.
      </footer>
    </div>
  )
}

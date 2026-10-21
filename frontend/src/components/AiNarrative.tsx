import { Bot, ShieldCheck, Sparkles, RefreshCw } from 'lucide-react'
import type { AppConfig, Narrative } from '../lib/types'
import { Alert, Badge, Button, IconChip } from './ui'

interface Props {
  config: AppConfig | null
  narrative: Narrative | null
  error: string | null
  busy: boolean
  onGenerate: () => void
}

export function NarrativeText({ narrative }: { narrative: Narrative }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent" icon={Sparkles}>
          AI-generated
        </Badge>
        <span className="text-xs text-ink-muted">
          {narrative.provider} · {narrative.model}
        </span>
      </div>
      <div className="whitespace-pre-line text-sm leading-relaxed text-ink">{narrative.text}</div>
      <p className="text-xs text-ink-muted">{narrative.disclaimer}</p>
    </div>
  )
}

export function AiNarrative({ config, narrative, error, busy, onGenerate }: Props) {
  const enabled = config?.ai.enabled ?? false
  return (
    <section className={`rounded-2xl p-5 shadow-card ${enabled ? 'gradient-border' : 'border border-dashed border-line-strong bg-surface/70'}`} aria-labelledby="ai-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconChip icon={Bot} tone={enabled ? 'brand' : 'neutral'} />
          <div>
            <h2 id="ai-title" className="text-base font-semibold tracking-tight text-ink">
              AI commentary <span className="font-normal text-ink-muted">(optional)</span>
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">A plain-English summary of the results above</p>
          </div>
        </div>
        {enabled && (
          <Button variant={narrative ? 'secondary' : 'primary'} icon={narrative ? RefreshCw : Sparkles} onClick={onGenerate} busy={busy}>
            {narrative ? 'Regenerate' : 'Generate commentary'}
          </Button>
        )}
      </div>
      {!enabled && <p className="text-sm text-ink-2">AI commentary is turned off on this server. Every chart, KPI and export above works without it.</p>}
      {enabled && !narrative && !error && (
        <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-good" />
          Only aggregated figures (KPI values and group totals) are sent to the AI provider, never your raw rows or file name. Free-tier providers
          may use submitted text to improve their products.
        </p>
      )}
      {error && (
        <Alert kind="warning" title="Commentary unavailable">
          {error}
        </Alert>
      )}
      {narrative && (
        <div className="animate-rise">
          <NarrativeText narrative={narrative} />
          <details className="mt-3 text-xs text-ink-2">
            <summary className="cursor-pointer font-medium text-accent-text">Exactly what was sent to the AI provider</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-surface-2 p-3">{JSON.stringify(narrative.shared_payload, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  )
}

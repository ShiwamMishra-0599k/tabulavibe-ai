import type { AppConfig, Narrative } from '../lib/types'
import { Alert, Badge, Button, Card } from './ui'

interface Props {
  config: AppConfig | null
  narrative: Narrative | null
  error: string | null
  busy: boolean
  onGenerate: () => void
}

export function NarrativeText({ narrative }: { narrative: Narrative }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">AI-generated</Badge>
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
    <Card
      title="AI commentary (optional)"
      actions={
        enabled && (
          <Button onClick={onGenerate} busy={busy}>
            {narrative ? 'Regenerate' : 'Generate commentary'}
          </Button>
        )
      }
    >
      {!enabled && (
        <p className="text-sm text-ink-2">
          AI commentary is turned off on this server. Every chart, KPI and export above works without it.
        </p>
      )}
      {enabled && !narrative && !error && (
        <p className="text-sm text-ink-2">
          Generates a short, plain-English summary of the calculated results. Only aggregated figures (KPI values and group totals) are sent
          to the AI provider, never your raw rows or file name. Free-tier providers may use submitted text to improve their products.
        </p>
      )}
      {error && <Alert kind="warning" title="Commentary unavailable">{error}</Alert>}
      {narrative && (
        <>
          <NarrativeText narrative={narrative} />
          <details className="mt-3 text-xs text-ink-2">
            <summary className="cursor-pointer">Exactly what was sent to the AI provider</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-2 p-3">{JSON.stringify(narrative.shared_payload, null, 2)}</pre>
          </details>
        </>
      )}
    </Card>
  )
}

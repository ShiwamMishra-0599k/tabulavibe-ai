import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { CircleCheck, LoaderCircle, MessagesSquare, SendHorizontal, Sparkles, TriangleAlert } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { askAgent, providerModel, rowsOf, suggestedQuestions, type AgentReport, type ChatAnswer, type ChatChart, type ChatMessage } from '../../lib/agent'
import { BarComparison, ShareChart, TrendChart } from '../Charts'
import { Alert, Badge, Button, Card, labelClass } from '../ui'

interface Props {
  file: File | null
  report: AgentReport
  aiEnabled: boolean
}

/** Inline **bold** only; everything else is plain text (never HTML). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))
}

/** Paragraphs and "- " bullet lists. */
function AnswerText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={`u${blocks.length}`} className="ml-4 grid list-disc gap-1">{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>)
    bullets = []
  }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (/^[-*•]\s+/.test(t)) bullets.push(t.replace(/^[-*•]\s+/, ''))
    else {
      flush()
      if (t) blocks.push(<p key={`p${blocks.length}`}>{inline(t)}</p>)
    }
  }
  flush()
  return <div className="grid gap-2 text-sm leading-relaxed text-ink-2">{blocks}</div>
}

function AnswerChart({ chart }: { chart: ChatChart }) {
  const rows = rowsOf(chart.rows.map((r) => ({ group: r.label, rows: 0, value: r.value })))
  return (
    <figure className="min-w-0 rounded-2xl border border-line bg-surface p-3">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-ink">
        {chart.title}
        <span className="tabular rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2 ring-1 ring-inset ring-line">{chart.evidence_id}</span>
      </figcaption>
      {chart.kind === 'line' && <TrendChart rows={rows} measureKey="v" measureLabel={chart.measure} height={220} />}
      {chart.kind === 'bar' && <BarComparison rows={rows} measureKey="v" measureLabel={chart.measure} />}
      {chart.kind === 'pie' && <ShareChart rows={rows} measureKey="v" measureLabel={chart.measure} total={null} />}
    </figure>
  )
}

function Answer({ answer, onAsk, busy }: { answer: ChatAnswer; onAsk: (q: string) => void; busy: boolean }) {
  return (
    <div className="grid gap-3">
      <AnswerText text={answer.answer} />
      {answer.charts.length > 0 && <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">{answer.charts.map((c) => <AnswerChart key={`${c.evidence_id}-${c.kind}`} chart={c} />)}</div>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        {answer.grounded ? (
          <Badge tone="good" icon={CircleCheck}>
            Numbers checked
          </Badge>
        ) : (
          <Badge tone="warn" icon={TriangleAlert}>
            Unverified: {answer.unverified_numbers.join(', ')}
          </Badge>
        )}
        {answer.evidence_ids.map((id) => (
          <span key={id} className="tabular rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2 ring-1 ring-inset ring-line" title="Evidence: a Python calculation">
            {id}
          </span>
        ))}
        <span>· {providerModel(answer.provider, answer.model)}</span>
      </div>
      {answer.provider_switches.length > 0 && <p className="text-xs text-ink-muted">{answer.provider_switches.join('. ')}.</p>}
      {answer.follow_up_questions.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Suggested follow-up questions">
          {answer.follow_up_questions.map((q) => (
            <button key={q} type="button" disabled={busy} onClick={() => onAsk(q)} className="rounded-full border border-line bg-surface px-3 py-1 text-left text-xs font-medium text-ink-2 transition hover:border-accent/50 hover:text-ink disabled:opacity-50">
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AskAI({ file, report, aiEnabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [evidence, setEvidence] = useState<ChatAnswer['new_evidence']>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [messages, busy])

  async function ask(text: string) {
    const q = text.trim()
    if (!q || busy || !file) return
    const history = messages
    setMessages([...history, { role: 'user', text: q }])
    setQuestion('')
    setError(null)
    setBusy(true)
    try {
      const answer = await askAgent(file, report, q, history, evidence)
      setMessages((m) => [...m, { role: 'assistant', text: answer.answer, answer }])
      setEvidence((e) => [...e, ...answer.new_evidence])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The question could not be answered. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void ask(question)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void ask(question)
    }
  }

  const suggestions = suggestedQuestions(report)
  return (
    <Card title="Ask AI about this data" subtitle="Answers come from this report's calculations. Every number is checked against the evidence it cites, and charts are drawn from Python's results." icon={MessagesSquare}>
      {!aiEnabled && (
        <div className="mb-4">
          <Alert kind="info" title="Ask AI is not switched on">
            It needs an AI provider (Groq or NVIDIA) on the server. The rest of the report works without it.
          </Alert>
        </div>
      )}
      <div role="log" aria-label="Conversation" aria-live="polite" className="grid gap-4">
        {messages.length === 0 && (
          <div className="grid gap-2">
            <p className="text-sm text-ink-muted">Try one of these, or ask your own question:</p>
            <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
              {suggestions.map((q) => (
                <button key={q} type="button" disabled={!aiEnabled || busy} onClick={() => void ask(q)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-sm font-medium text-ink-2 transition hover:border-accent/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm text-ink">
              <span className="sr-only">You asked: </span>
              {m.text}
            </div>
          ) : (
            <article key={i} aria-label="AI answer" className="min-w-0 rounded-2xl rounded-bl-md border border-line bg-surface-2/60 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-accent-text">
                <Sparkles aria-hidden className="size-3.5" /> AI analyst
              </p>
              {m.answer && <Answer answer={m.answer} onAsk={(q) => void ask(q)} busy={busy} />}
            </article>
          ),
        )}
        {busy && (
          <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
            <LoaderCircle aria-hidden className="size-4 animate-spin" /> Reading the report and running calculations…
          </p>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="mt-4 grid gap-2">
        <label htmlFor="ask-ai-question" className={labelClass}>
          Your question
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="ask-ai-question"
            rows={2}
            maxLength={1000}
            value={question}
            disabled={!aiEnabled}
            placeholder="e.g. Why did revenue drop in April?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKey}
            className="min-w-0 flex-1 resize-y rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-soft transition hover:border-accent/50 focus:border-accent disabled:opacity-50"
          />
          <Button type="submit" variant="primary" icon={SendHorizontal} busy={busy} disabled={!aiEnabled || !question.trim()}>
            Ask
          </Button>
        </div>
        <p className="text-xs text-ink-muted">Only aggregated results and column names are shared with the AI provider, never raw rows. Answers describe associations in this file, not causes.</p>
      </form>
    </Card>
  )
}

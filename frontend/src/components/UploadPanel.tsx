import { useRef, useState, type DragEvent } from 'react'
import type { AppConfig, SampleInfo } from '../lib/types'
import { formatCount } from '../lib/format'
import { Button, Card } from './ui'

interface Props {
  config: AppConfig | null
  samples: SampleInfo[]
  busy: boolean
  onFile: (file: File) => void
  onSample: (sample: SampleInfo) => void
}

export function UploadPanel({ config, samples, busy, onFile, onSample }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const limits = config?.limits

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file && !busy) onFile(file)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Upload a spreadsheet">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-10 text-center transition ${
            dragging ? 'border-accent bg-accent-soft' : 'border-line-strong'
          }`}
        >
          <p className="text-sm text-ink">Drag a CSV or Excel (.xlsx) file here, or</p>
          <Button variant="primary" busy={busy} onClick={() => input.current?.click()}>
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
          {limits && (
            <p className="max-w-md text-xs text-ink-muted">
              Up to {limits.max_upload_mb} MB, {formatCount(limits.max_rows)} rows and {limits.max_columns} columns. The first row must
              contain column names. For Excel files only the first sheet is read, and formulas use their last saved values.
            </p>
          )}
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Files are processed in memory for each request and are not stored. This is a demonstration tool: do not upload confidential or
          regulated data.
        </p>
      </Card>

      <Card title="No file? Try a sample">
        <ul className="grid gap-3">
          {samples.map((sample) => (
            <li key={sample.id} className="rounded-lg border border-line p-3">
              <p className="text-sm font-medium text-ink">{sample.title}</p>
              <p className="mt-1 text-xs text-ink-2">{sample.description}</p>
              <Button className="mt-3" disabled={busy} onClick={() => onSample(sample)} aria-label={`Load sample: ${sample.title}`}>
                Load sample
              </Button>
            </li>
          ))}
          {samples.length === 0 && <li className="text-sm text-ink-muted">Samples are unavailable while the server cannot be reached.</li>}
        </ul>
        <p className="mt-3 text-xs text-ink-muted">All sample data is synthetic.</p>
      </Card>
    </div>
  )
}

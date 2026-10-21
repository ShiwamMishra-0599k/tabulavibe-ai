import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { api } from '../lib/api'
import { LOCALE, formatCount } from '../lib/format'
import type { RepoInfo } from '../lib/types'
import { GitHubMark } from './SignInDialog'

// Badge-style count: 999, 1.2K, 12K (one decimal at most, like GitHub's own star button).
const starFormat = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })

/** GitHub logo + star count for the project repo. The count comes from our backend (cached), never from the browser. */
export function GitHubStars() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)

  useEffect(() => {
    let active = true
    api
      .github()
      .then((info) => active && setRepo(info))
      .catch(() => undefined) // optional decoration: hide it if the server cannot say
    return () => {
      active = false
    }
  }, [])

  if (!repo?.url) return null
  const label =
    repo.stars === null ? 'TabulaVibe AI on GitHub' : `TabulaVibe AI on GitHub, ${formatCount(repo.stars)} ${repo.stars === 1 ? 'star' : 'stars'}`

  return (
    <a
      href={repo.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={repo.stars === null ? 'View on GitHub' : 'Star on GitHub'}
      className="inline-flex min-h-8 items-center overflow-hidden rounded-lg border border-line-strong bg-surface text-xs font-semibold text-ink shadow-soft transition hover:border-accent/50 hover:bg-surface-2"
    >
      <span className="flex items-center gap-1.5 px-2 py-1">
        <GitHubMark />
        <span className="hidden sm:inline">GitHub</span>
      </span>
      {repo.stars !== null && (
        <span className="flex items-center gap-1 self-stretch border-l border-line bg-surface-2 px-2 tabular">
          <Star aria-hidden className="size-3.5 fill-warn text-warn" />
          {starFormat.format(repo.stars)}
        </span>
      )}
    </a>
  )
}

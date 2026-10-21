import { useState } from 'react'
import { ArrowLeft, ChartNoAxesColumn, FolderOpen, Lock, ShieldCheck, UserRoundPlus } from 'lucide-react'
import { ProviderDisabledError, type OAuthProvider } from '../lib/auth'
import { GitHubMark, GoogleMark } from './SignInDialog'
import { Alert, IconChip } from './ui'

interface Props {
  onSignUp: (provider: OAuthProvider) => Promise<void>
  onSignInInstead: () => void
  onBack: () => void
  /** True when an uploaded file or analysis is open: the OAuth redirect reloads the page. */
  hasOpenWork: boolean
}

const PROVIDERS: { id: OAuthProvider; name: string; mark: () => React.ReactElement }[] = [
  { id: 'google', name: 'Google', mark: GoogleMark },
  { id: 'github', name: 'GitHub', mark: GitHubMark },
]

const BENEFITS = [
  { icon: FolderOpen, text: 'Save reports and reopen them any time, on any device.' },
  { icon: Lock, text: 'Only you can see your reports. Uploaded files and raw rows are never stored.' },
  { icon: ShieldCheck, text: 'No password to remember: Google or GitHub confirms who you are.' },
]

/** Sign-up page. The first Google/GitHub sign-in creates the TabulaVibe profile (database trigger). */
export function SignUpPage({ onSignUp, onSignInInstead, onBack, hasOpenWork }: Props) {
  const [pending, setPending] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function start(provider: OAuthProvider) {
    setPending(provider)
    setError(null)
    try {
      await onSignUp(provider) // the browser now leaves for the provider's consent page
    } catch (e) {
      setError(e instanceof ProviderDisabledError ? e.message : 'Sign-up could not start. Check your connection and try again.')
      setPending(null)
    }
  }

  return (
    <div className="animate-rise mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-line bg-surface shadow-float lg:grid-cols-[1fr_1.1fr]">
      <aside className="brand-gradient relative hidden flex-col justify-between gap-10 p-10 text-white lg:flex">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ChartNoAxesColumn aria-hidden className="size-5" />
          TabulaVibe AI
        </div>
        <div>
          <p className="text-3xl font-bold leading-tight tracking-tight">Your dashboards, saved and ready when you are.</p>
          <ul className="mt-8 grid gap-4">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-sm text-white/90">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/70">Analysing files never needs an account. Sign up only to save reports.</p>
      </aside>

      <section className="grid content-center gap-6 p-6 sm:p-10" aria-labelledby="sign-up-title">
        <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-muted transition hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" />
          Back
        </button>

        <div>
          <IconChip icon={UserRoundPlus} tone="brand" size="lg" />
          <h1 id="sign-up-title" className="mt-4 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Create your TabulaVibe account
          </h1>
          <p className="mt-1.5 text-sm text-ink-2">Use your Gmail (Google) or GitHub account. Your profile is created on your first sign-in.</p>
        </div>

        <div className="grid gap-3">
          {PROVIDERS.map(({ id, name, mark: Mark }) => (
            <button
              key={id}
              type="button"
              onClick={() => start(id)}
              disabled={pending !== null}
              aria-busy={pending === id || undefined}
              className="flex min-h-12 items-center justify-center gap-3 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink shadow-soft transition hover:border-accent/50 hover:bg-surface-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Mark />
              {pending === id ? `Opening ${name}…` : `Sign up with ${name}`}
            </button>
          ))}
        </div>

        {hasOpenWork && (
          <Alert kind="warning" title="Your open file will be closed">
            Signing up takes you to Google or GitHub and back, which reloads the page. Upload the file again afterwards.
          </Alert>
        )}
        {error && <Alert kind="error">{error}</Alert>}

        <p className="text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <button type="button" onClick={onSignInInstead} className="font-semibold text-accent-text hover:underline">
            Sign in
          </button>
        </p>
        <p className="text-center text-xs leading-relaxed text-ink-muted">
          We receive only your name, email address and profile picture from the provider. No password is shared with TabulaVibe.
        </p>
      </section>
    </div>
  )
}

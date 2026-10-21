import { useEffect, useRef, useState } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import type { OAuthProvider } from '../lib/auth'

type Provider = 'Google' | 'GitHub'

const PROVIDER_IDS: Record<Provider, OAuthProvider> = { Google: 'google', GitHub: 'github' }

export function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path fill="#4285F4" d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5a4.7 4.7 0 0 1-2 3.1v2.5h3.2c1.9-1.8 3.1-4.3 3.1-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.2-2.5c-.9.6-2 .9-3.5.9-2.7 0-5-1.8-5.8-4.3H2.9v2.6A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.2 13.7a6 6 0 0 1 0-3.5V7.6H2.9A10 10 0 0 0 2 12c0 1.6.4 3.1.9 4.4l3.3-2.7Z" />
      <path fill="#EA4335" d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.9-2.8A9.9 9.9 0 0 0 2.9 7.6l3.3 2.6C7 7.8 9.3 6 12 6Z" />
    </svg>
  )
}

export function GitHubMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5 fill-current">
      <path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.8 9.6.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.3-2.2-.3-4.5-1.1-4.5-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1.1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.8-1.1 2.8-1.1.5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.5 4.9.4.3.7.9.7 1.8v2.6c0 .3.2.6.7.5a10.2 10.2 0 0 0 6.8-9.6C22 6.6 17.5 2 12 2Z" />
    </svg>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  /** Starts Supabase OAuth. Undefined when accounts are not configured on this server. */
  onSignIn?: (provider: OAuthProvider) => Promise<void>
  /** Opens the sign-up page. */
  onCreateAccount?: () => void
  /** True when a file is open: the OAuth redirect reloads the page. */
  hasOpenWork?: boolean
}

export function SignInDialog({ open, onClose, onSignIn, onCreateAccount, hasOpenWork = false }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setSelectedProvider(null)
    setError(null)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelectedProvider(null)
      setError(null)
      onClose()
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [open, onClose])

  if (!open) return null

  async function choose(provider: Provider) {
    setSelectedProvider(provider)
    setError(null)
    if (!onSignIn) return
    try {
      await onSignIn(PROVIDER_IDS[provider]) // the browser now leaves for the provider's consent page
    } catch {
      setError(`${provider} sign-in could not start. Check your connection and try again.`)
      setSelectedProvider(null)
    }
  }

  const redirecting = !!onSignIn && selectedProvider !== null && !error

  const providerButton = (provider: Provider, Icon: typeof GoogleMark) => (
    <button
      type="button"
      onClick={() => choose(provider)}
      disabled={redirecting}
      aria-busy={(redirecting && selectedProvider === provider) || undefined}
      className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink shadow-soft transition hover:border-accent/50 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon />
      Continue with {provider}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4 backdrop-blur-sm" role="presentation" onMouseDown={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-title"
        className="w-full max-w-sm animate-rise rounded-2xl border border-line bg-surface p-6 shadow-float"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">TabulaVibe AI</p>
            <h2 id="sign-in-title" className="mt-1 text-xl font-bold tracking-tight text-ink">Sign in</h2>
            <p className="mt-1 text-sm text-ink-muted">Continue with the account you use most.</p>
          </div>
          <button ref={closeButton} type="button" onClick={close} className="grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-2 hover:text-ink" aria-label="Close sign in dialog">
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="mt-6 grid gap-3">
          {providerButton('Google', GoogleMark)}
          {providerButton('GitHub', GitHubMark)}
        </div>
        {hasOpenWork && onSignIn && (
          <p className="mt-4 flex gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-xs leading-5 text-ink-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warn" />
            Signing in reloads the page, so your open file will be closed. Upload it again afterwards.
          </p>
        )}
        {selectedProvider && (
          <p role="status" className="mt-4 rounded-xl bg-accent-soft px-3 py-2.5 text-xs leading-5 text-accent-text">
            {onSignIn ? `Opening ${selectedProvider}…` : `${selectedProvider} sign-in will be available after OAuth is configured for this app.`}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-bad-soft px-3 py-2.5 text-xs leading-5 text-bad">
            {error}
          </p>
        )}
        {onCreateAccount && (
          <p className="mt-5 text-center text-sm text-ink-muted">
            New to TabulaVibe?{' '}
            <button type="button" onClick={onCreateAccount} className="font-semibold text-accent-text hover:underline">
              Create an account
            </button>
          </p>
        )}
        <p className="mt-5 text-center text-xs leading-5 text-ink-muted">By continuing, you agree to the terms and privacy policy.</p>
      </section>
    </div>
  )
}

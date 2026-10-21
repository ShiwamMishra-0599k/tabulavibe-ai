import { useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { AppConfig } from './types'

/**
 * Sign-in with Google or GitHub through Supabase Auth. The URL and anon key come from the
 * backend's /api/config (both are public by design); the browser never sees a secret key.
 * The access token is sent to our own backend, which uses it to read and write only the
 * signed-in user's rows (Row Level Security).
 */
export type OAuthProvider = 'google' | 'github'

export type AuthState =
  | { status: 'disabled' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: Session }

const clients = new Map<string, Promise<SupabaseClient>>()

/** supabase-js is loaded on demand, so visitors on a server without accounts never download it. */
function loadClient(url: string, anonKey: string): Promise<SupabaseClient> {
  const key = `${url}|${anonKey}`
  let client = clients.get(key)
  if (!client) {
    client = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, anonKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }),
    )
    clients.set(key, client)
  }
  return client
}

export function useAuth(config: AppConfig | null) {
  const storage = config?.storage
  const url = storage?.enabled ? storage.supabase_url : null
  const anonKey = storage?.enabled ? storage.supabase_anon_key : null
  // undefined = not checked yet; null = signed out.
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (!url || !anonKey) return
    let active = true
    let unsubscribe = () => {}
    const apply = (next: Session | null) => {
      if (active) setSession(next)
    }
    loadClient(url, anonKey)
      .then((client) => {
        if (!active) return
        client.auth
          .getSession()
          .then(({ data }) => apply(data.session))
          .catch(() => apply(null))
        const { data } = client.auth.onAuthStateChange((_event, next) => {
          apply(next)
          // Remove the one-time ?code= from the address bar after the OAuth redirect.
          if (next && window.location.search.includes('code=')) window.history.replaceState(null, '', window.location.pathname)
        })
        unsubscribe = () => data.subscription.unsubscribe()
      })
      .catch(() => apply(null))
    return () => {
      active = false
      unsubscribe()
    }
  }, [url, anonKey])

  const state: AuthState = !config
    ? { status: 'loading' }
    : !url || !anonKey
      ? { status: 'disabled' }
      : session === undefined
        ? { status: 'loading' }
        : session
          ? { status: 'signed-in', session }
          : { status: 'signed-out' }

  async function client(): Promise<SupabaseClient> {
    if (!url || !anonKey) throw new ApiError('storage_disabled', 'Sign-in is not enabled on this server.', 503)
    return loadClient(url, anonKey)
  }

  async function signIn(provider: OAuthProvider): Promise<void> {
    const { error } = await (await client()).auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/` } })
    if (error) throw error
  }

  async function signOut(): Promise<void> {
    await (await client()).auth.signOut()
  }

  /** A fresh access token (supabase-js refreshes it automatically when it is close to expiry). */
  async function token(): Promise<string> {
    const { data } = await (await client()).auth.getSession()
    if (!data.session) throw new ApiError('auth_required', 'Your sign-in has expired. Please sign in again.', 401)
    return data.session.access_token
  }

  return { state, signIn, signOut, token }
}

export type Auth = ReturnType<typeof useAuth>

import { QueryClient } from '@tanstack/react-query'
import type { LoginResponse, PublicConfig } from '../../shared/domain'
import { pageSession } from './page-session'
export { pageSession } from './page-session'

export const queryClient = new QueryClient({ defaultOptions: { queries: {
  retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 0,
} } })
export class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }
function revokePageToken(pageToken: string) {
  const body = JSON.stringify({ pageToken })
  if (navigator.sendBeacon?.('/api/lock', new Blob([body], { type: 'application/json' }))) return
  void fetch('/api/lock', { method: 'POST', credentials: 'same-origin', keepalive: true,
    headers: { 'Content-Type': 'application/json' }, body }).catch(() => {})
}
function clearSession(cancelConfig: boolean) {
  const previous = pageSession.clear()
  void queryClient.cancelQueries({ predicate: query => cancelConfig || query.queryKey[0] !== 'config' })
  queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'config' })
  queryClient.setQueryData<PublicConfig>(['config'], current => current ? { ...current, authenticated: false, serverUrl: '', legacyInstanceIds: undefined } : current)
  if (previous) revokePageToken(previous)
}
export function lockSession() { clearSession(true) }
export function syncEntryVerification(required: boolean) {
  pageSession.setRequireEntryVerification(required)
  queryClient.setQueryData<PublicConfig>(['config'], current => current && current.requireEntryVerification !== required ? { ...current, requireEntryVerification: required } : current)
  if (required && !pageSession.token && queryClient.getQueryData<PublicConfig>(['config'])?.authenticated) lockSession()
}
export async function loadConfig(signal?: AbortSignal) {
  const config = await api<PublicConfig>('/config', undefined, signal)
  pageSession.setRequireEntryVerification(config.requireEntryVerification)
  if (!config.authenticated && (pageSession.token || queryClient.getQueryData<PublicConfig>(['config'])?.authenticated)) clearSession(false)
  return config
}
export function acceptLogin(response: LoginResponse, epoch: number) {
  if (pageSession.requireEntryVerification && document.visibilityState !== 'visible') {
    revokePageToken(response.pageToken)
    throw new DOMException('页面已锁定，请重新验证', 'AbortError')
  }
  pageSession.activate(response.pageToken, epoch)
}
export async function loginWithPassword(password: string) {
  const epoch = pageSession.epoch
  acceptLogin(await api<LoginResponse>('/login', { password }), epoch)
}
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal, method = 'POST'): Promise<T> {
  const epoch = pageSession.epoch, pageToken = pageSession.token
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : method, credentials: 'same-origin', signal,
    cache: 'no-store', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(pageToken ? { 'x-page-session': pageToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (pageSession.epoch !== epoch) {
    if ((path === '/login' || path === '/passkeys/login/verify') && typeof data.pageToken === 'string') revokePageToken(data.pageToken)
    pageSession.assertCurrent(epoch)
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && !path.startsWith('/passkeys/login/')) lockSession()
    throw new ApiError(data.error ?? '连接失败，请稍后重试', response.status)
  }
  return data
}

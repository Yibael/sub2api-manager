import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({ defaultOptions: { queries: {
  retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 0,
} } })
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal, method = 'POST'): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : method, credentials: 'same-origin', signal,
    cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') window.dispatchEvent(new Event('session-expired'))
    throw new Error(data.error ?? '连接失败，请稍后重试')
  }
  return data
}

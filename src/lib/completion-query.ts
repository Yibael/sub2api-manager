import { useEffect, useState } from 'react'
import { useQuery, type QueryKey, type QueryClient } from '@tanstack/react-query'
import { queryClient } from './api'
import { toast } from 'sonner'

export function refreshDelay(completedAt: number, seconds: number, now = Date.now()) {
  return Math.max(0, completedAt + seconds * 1000 - now)
}
const forced = new Map<string, Promise<unknown>>()
export function forceQuery<T>(client: QueryClient, key: QueryKey, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const id = JSON.stringify(key)
  const pending = forced.get(id)
  if (pending) return pending as Promise<T>
  const request = (async () => {
    await client.cancelQueries({ queryKey: key, exact: true })
    return client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => load(signal), staleTime: 0, retry: false })
  })()
  forced.set(id, request)
  void request.finally(() => { if (forced.get(id) === request) forced.delete(id) }).catch(() => {})
  return request
}
export function useCompletionQuery<T>(key: QueryKey, seconds: number, enabled: boolean, load: (force: boolean, signal: AbortSignal) => Promise<T>, options: { refetchOnMount?: boolean | 'always' } = {}) {
  const [forcing, setForcing] = useState(false)
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => load(false, signal), enabled,
    staleTime: seconds * 1000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: true, meta: { poll: true }, ...options })
  const { fetchStatus, refetch } = query
  const completedAt = Math.max(query.dataUpdatedAt, query.errorUpdatedAt)
  const identity = JSON.stringify(key)
  useEffect(() => {
    if (!enabled || forcing || fetchStatus !== 'idle' || !completedAt || !navigator.onLine || forced.has(identity)) return
    const timer = window.setTimeout(() => { void refetch({ cancelRefetch: false }) }, refreshDelay(completedAt, seconds))
    return () => window.clearTimeout(timer)
  }, [enabled, forcing, fetchStatus, completedAt, seconds, identity, refetch])
  async function forceRefresh() {
    if (!enabled) return
    setForcing(true)
    try { return await forceQuery(queryClient, key, signal => load(true, signal)) }
    catch (error) { toast.error((error as Error).message) }
    finally { setForcing(false) }
  }
  return { ...query, isFetching: query.isFetching || forcing, forceRefresh }
}

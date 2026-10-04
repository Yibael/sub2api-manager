import { useEffect, useRef, useState } from 'react'
import { queryOptions, useQuery, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { queryClient } from './api'
import { forceQuery } from './completion-query'
import { useForeground } from './foreground'

export function manualQueryOptions<T>(key: QueryKey, load: (signal: AbortSignal) => Promise<T>) {
  return queryOptions({ queryKey: key, queryFn: ({ signal }) => load(signal), enabled: false,
    staleTime: Infinity, retry: false, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, meta: { poll: false } })
}

/** One foreground snapshot read after activation; subsequent reads require an explicit action. */
export function useManualQuery<T>(key: QueryKey, load: (force: boolean, signal: AbortSignal) => Promise<T>, enabled = true) {
  const query = useQuery(manualQueryOptions(key, signal => load(false, signal)))
  const [forcing, setForcing] = useState(false)
  const visible = useForeground(), started = useRef(new Set<string>())
  const identity = JSON.stringify(key), { refetch } = query
  useEffect(() => {
    if (!enabled || !visible || started.current.has(identity)) return
    started.current.add(identity)
    // A toolbar refresh before the card became visible already supplied this entry's read.
    if (query.isFetchedAfterMount) return
    void refetch({ cancelRefetch: false })
  }, [enabled, visible, identity, refetch, query.isFetchedAfterMount])
  async function forceRefresh() {
    started.current.add(identity)
    setForcing(true)
    try { return await forceQuery(queryClient, key, signal => load(true, signal)) }
    catch (error) { toast.error((error as Error).message) }
    finally { setForcing(false) }
  }
  return { ...query, isFetching: query.isFetching || forcing, forceRefresh }
}

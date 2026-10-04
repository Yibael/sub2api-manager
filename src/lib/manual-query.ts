import { useEffect, useState } from 'react'
import { queryOptions, useQuery, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { queryClient } from './api'
import { forceQuery } from './completion-query'

export function manualQueryOptions<T>(key: QueryKey, load: (signal: AbortSignal) => Promise<T>) {
  return queryOptions({ queryKey: key, queryFn: ({ signal }) => load(signal), enabled: false,
    staleTime: Infinity, retry: false, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
}

/** One snapshot read per page entry; all subsequent reads require an explicit action. */
export function useManualQuery<T>(key: QueryKey, load: (force: boolean, signal: AbortSignal) => Promise<T>) {
  const query = useQuery(manualQueryOptions(key, signal => load(false, signal)))
  const [forcing, setForcing] = useState(false)
  const identity = JSON.stringify(key), { refetch } = query
  useEffect(() => { void refetch({ cancelRefetch: false }) }, [identity, refetch])
  async function forceRefresh() {
    setForcing(true)
    try { return await forceQuery(queryClient, key, signal => load(true, signal)) }
    catch (error) { toast.error((error as Error).message) }
    finally { setForcing(false) }
  }
  return { ...query, isFetching: query.isFetching || forcing, forceRefresh }
}

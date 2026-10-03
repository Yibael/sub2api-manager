import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, pageSession, queryClient } from './api'
import { useWorkspace } from './preferences'
import { useForeground } from './monitor'
import { forceQuery } from './completion-query'
import type { Sample } from '../../shared/domain'
import type { Group } from '../../shared/groups'

export function useGroups() {
  const { config } = useWorkspace(), visible = useForeground()
  const [forcing, setForcing] = useState(false)
  const key = ['groups', config.instanceId]
  const query = useQuery<Sample<Group[]>>({ queryKey: key, queryFn: ({ signal }) => api('/groups', undefined, signal), enabled: visible,
    staleTime: 60_000, retry: false, refetchOnWindowFocus: false, meta: { poll: true } })
  async function refresh() {
    setForcing(true)
    try { return await forceQuery<Sample<Group[]>>(queryClient, key, signal => api('/groups?force=true', undefined, signal)) }
    catch (error) { toast.error((error as Error).message) }
    finally { setForcing(false) }
  }
  async function saved(group: Group) {
    const epoch = pageSession.epoch
    await queryClient.cancelQueries({ queryKey: key })
    pageSession.assertCurrent(epoch)
    queryClient.setQueryData<Sample<Group[]>>(key, current => current?.data ? {
      data: current.data.map(item => item.id === group.id ? group : item), error: null, updatedAt: Date.now(),
    } : undefined)
    void queryClient.invalidateQueries({ queryKey: key })
  }
  return { ...query, isFetching: query.isFetching || forcing, refresh, saved }
}

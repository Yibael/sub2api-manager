import { api, pageSession, queryClient } from './api'
import { useWorkspace } from './preferences'
import { useManualQuery } from './manual-query'
import type { Sample } from '../../shared/domain'
import type { Group } from '../../shared/groups'

export function useGroups(enabled: boolean) {
  const { config } = useWorkspace()
  const key = ['groups', config.instanceId]
  const query = useManualQuery<Sample<Group[]>>(key,
    (force, signal) => api(`/groups${force ? '?force=true' : ''}`, undefined, signal), enabled)
  async function saved(group: Group) {
    const epoch = pageSession.epoch
    await queryClient.cancelQueries({ queryKey: key })
    pageSession.assertCurrent(epoch)
    queryClient.setQueryData<Sample<Group[]>>(key, current => current?.data ? {
      data: current.data.map(item => item.id === group.id ? group : item), error: null, updatedAt: Date.now(),
    } : undefined)
    void queryClient.invalidateQueries({ queryKey: key })
  }
  return { ...query, refresh: query.forceRefresh, saved }
}

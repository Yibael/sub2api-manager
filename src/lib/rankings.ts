import { useState } from 'react'
import { api } from './api'
import { useManualQuery } from './manual-query'
import { useWorkspace } from './preferences'
import { rankingsIncludeAdmin } from '../../shared/preferences'
import { userRankingPeriod, type RankingRange, type Sample, type UserRanking, type ModelRankingRange, type ModelRanking } from '../../shared/domain'

export function useUserRankings(now: number, range: RankingRange, near = true) {
  const { config, preferences } = useWorkspace()
  const [enteredAt] = useState(now)
  const body = { range, timeZone: preferences.timeZone, includeAdmin: rankingsIncludeAdmin(preferences) }
  const query = useManualQuery<Sample<UserRanking>>(['user-rankings', config.instanceId, body],
    (force, signal) => api('/spending/rankings', { ...body, force }, signal), near)
  // Date/hour changes never create an automatic query. A manual response owns its period.
  const period = query.data?.data ?? userRankingPeriod(range, new Date(enteredAt), preferences.timeZone, config.serverTimeZone)
  return { ...query, period }
}
export function useModelRankings(now: number, range: ModelRankingRange, near = true) {
  const { config, preferences } = useWorkspace()
  const [enteredAt] = useState(now)
  const body = { range, timeZone: preferences.timeZone, includeAdmin: rankingsIncludeAdmin(preferences) }
  const query = useManualQuery<Sample<ModelRanking>>(['model-rankings', config.instanceId, body],
    (force, signal) => api('/spending/models', { ...body, force }, signal), near)
  const period = query.data?.data ?? userRankingPeriod(range, new Date(enteredAt), preferences.timeZone, preferences.timeZone)
  return { ...query, period }
}

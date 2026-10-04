import { api } from './api'
import { useCompletionQuery } from './completion-query'
import { useForeground } from './monitor'
import { useWorkspace } from './preferences'
import { rankingsIncludeAdmin } from '../../shared/preferences'
import { userRankingPeriod, rankingInterval, type RankingRange, type Sample, type UserRanking, type ModelRankingRange, type ModelRanking } from '../../shared/domain'

export function useUserRankings(now: number, range: RankingRange) {
  const { config, preferences } = useWorkspace(), visible = useForeground()
  const body = { range, timeZone: preferences.timeZone, includeAdmin: rankingsIncludeAdmin(preferences) }
  const period = userRankingPeriod(range, new Date(now), preferences.timeZone, config.serverTimeZone)
  const query = useCompletionQuery<Sample<UserRanking>>(['user-rankings', config.instanceId, body, period.period], rankingInterval(config.intervals), visible,
    (force, signal) => api('/spending/rankings', { ...body, force }, signal))
  const matches = query.data?.data?.range === range && query.data.data.period === period.period
  return { ...query, period, data: query.data ? matches ? query.data : { ...query.data, data: null, updatedAt: null } : undefined }
}

export function useModelRankings(now: number, range: ModelRankingRange) {
  const { config, preferences } = useWorkspace(), visible = useForeground()
  const body = { range, timeZone: preferences.timeZone, includeAdmin: rankingsIncludeAdmin(preferences) }
  const period = userRankingPeriod(range, new Date(now), preferences.timeZone, preferences.timeZone)
  const query = useCompletionQuery<Sample<ModelRanking>>(['model-rankings', config.instanceId, body, period.period], rankingInterval(config.intervals), visible,
    (force, signal) => api('/spending/models', { ...body, force }, signal))
  const matches = query.data?.data?.range === range && query.data.data.period === period.period
  return { ...query, period, data: query.data ? matches ? query.data : { ...query.data, data: null, updatedAt: null } : undefined }
}

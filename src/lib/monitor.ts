import { useEffect, useMemo, useState } from 'react'
import { api, queryClient } from './api'
import { useWorkspace } from './preferences'
import { useCompletionQuery } from './completion-query'
import { refreshCountdown } from './refresh-countdown'
import { dateInZone, type Account, type Sample, type SpendingRow, type TodayStats, type Usage } from '../../shared/domain'
import type { MoneyAmount } from '../../shared/money'

export function useForeground() {
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  useEffect(() => {
    const change = () => {
      const shown = document.visibilityState === 'visible'
      setVisible(shown)
      if (!shown) void queryClient.cancelQueries({ predicate: query => query.meta?.poll === true })
      else void queryClient.invalidateQueries({ queryKey: ['config'] })
    }
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  return visible
}
export function useNow() {
  const foreground = useForeground()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!foreground) return
    const frame = requestAnimationFrame(() => setNow(Date.now()))
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(timer); cancelAnimationFrame(frame) }
  }, [foreground])
  return now
}
export function useDirectory() {
  const { config } = useWorkspace()
  const visible = useForeground()
  return useCompletionQuery<Sample<Account[]>>(['accounts', config.instanceId], 60, visible,
    (force, signal) => api(`/accounts${force ? '?force=true' : ''}`, undefined, signal))
}
export function useMonitor(requestedIds?: number[], withSpending = true, scope: 'all' | 'statistics' = 'all') {
  const { config, preferences } = useWorkspace()
  const visible = useForeground(), now = useNow()
  const [refreshing, setRefreshing] = useState(false)
  const idsIdentity = JSON.stringify(requestedIds ?? preferences.pins)
  const ids = useMemo(() => [...new Set(JSON.parse(idsIdentity) as number[])].sort((a, b) => a - b), [idsIdentity])
  const enabled = visible && ids.length > 0
  const status = useCompletionQuery<Record<number, Sample<Account>>>(['status', config.instanceId, ids], config.intervals.status, enabled,
    (force, signal) => api('/status', { ids, force }, signal))
  const day = dateInZone(new Date(now), config.serverTimeZone)
  const today = useCompletionQuery<{ day: string; items: Record<number, Sample<TodayStats>> }>(['today', config.instanceId, ids, day], config.intervals.status, enabled && scope === 'all',
    (force, signal) => api('/today', { ids, force }, signal))
  const eligible = ids.filter(id => status.data?.[id]?.data?.supportsUsage)
  const quotaEnabled = enabled && eligible.length > 0 && scope === 'all'
  const quota = useCompletionQuery<Record<number, Sample<Usage>>>(['quota', config.instanceId, eligible], config.intervals.quota, quotaEnabled,
    (force, signal) => api('/quota', { ids: eligible, force }, signal))
  const subscriptions = useMemo(() => preferences.subscriptions.filter(subscription => ids.includes(subscription.accountId) && (!status.data?.[subscription.accountId]?.data || status.data[subscription.accountId].data!.type === 'oauth'))
    .sort((a, b) => preferences.pins.indexOf(a.accountId) - preferences.pins.indexOf(b.accountId)), [preferences.subscriptions, preferences.pins, ids, status.data])
  const spendingBody = { subscriptions, timeZone: preferences.timeZone, includeAdmin: preferences.includeAdmin }
  const localDay = dateInZone(new Date(now), preferences.timeZone)
  const spendingEnabled = enabled && withSpending && subscriptions.length > 0
  const spending = useCompletionQuery<{ day: string; rows: SpendingRow[] }>(['spending', config.instanceId, spendingBody, localDay], config.intervals.spending, spendingEnabled,
    (force, signal) => api('/spending', { ...spendingBody, force }, signal))
  const dailyBody = { ids, timeZone: preferences.timeZone, includeAdmin: preferences.includeAdmin }
  const dailyEnabled = enabled && withSpending && requestedIds !== undefined
  const dailySpending = useCompletionQuery<{ day: string; items: Record<number, Sample<MoneyAmount>> }>(['daily-spending', config.instanceId, dailyBody, localDay], config.intervals.spending, dailyEnabled,
    (force, signal) => api('/spending/today', { ...dailyBody, force }, signal))
  const refresh = async () => {
    if (refreshing || !enabled) return
    setRefreshing(true)
    try {
      await status.forceRefresh()
      await Promise.all([...(scope === 'all' ? [today.forceRefresh(), quota.forceRefresh()] : []), spending.forceRefresh(), dailySpending.forceRefresh()])
    } finally { setRefreshing(false) }
  }
  const nextRefreshIn = refreshCountdown(now, [{ ...quota, enabled: quotaEnabled, interval: config.intervals.quota }])
  return { status, today: { ...today, data: today.data?.day === day ? today.data : undefined }, quota,
    spending: { ...spending, data: spending.data?.day === localDay ? spending.data : undefined }, refresh, refreshQuota: quota.forceRefresh, refreshing, now, nextRefreshIn,
    dailySpending: { ...dailySpending, data: dailySpending.data?.day === localDay ? dailySpending.data : undefined },
    isFetching: status.isFetching || today.isFetching || quota.isFetching || spending.isFetching || dailySpending.isFetching, subscriptions }
}
export type MonitorData = ReturnType<typeof useMonitor>

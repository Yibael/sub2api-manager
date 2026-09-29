import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, queryClient } from './api'
import { useWorkspace } from './preferences'
import { refreshCountdown } from './refresh-countdown'
import { dateInZone, type Account, type Sample, type SpendingRow, type TodayStats, type Usage } from '../../shared/domain'

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
  return useQuery({ queryKey: ['accounts', config.instanceId], queryFn: ({ signal }) => api<Sample<Account[]>>('/accounts', undefined, signal), enabled: visible, staleTime: 60_000, meta: { poll: true } })
}
export function useMonitor(requestedIds?: number[], withSpending = true) {
  const { config, preferences } = useWorkspace()
  const visible = useForeground()
  const now = useNow()
  const ids = [...new Set(requestedIds ?? preferences.pins)].sort((a, b) => a - b)
  const enabled = visible && ids.length > 0
  const polling = (seconds: number) => ({ enabled, refetchInterval: enabled ? seconds * 1000 : false as const, refetchIntervalInBackground: false, meta: { poll: true } })
  const status = useQuery({ queryKey: ['status', config.instanceId, ids], queryFn: ({ signal }) => api<Record<number, Sample<Account>>>('/status', { ids }, signal), ...polling(config.intervals.status) })
  const day = dateInZone(new Date(now), config.serverTimeZone)
  const today = useQuery({ queryKey: ['today', config.instanceId, ids, day], queryFn: ({ signal }) => api<{ day: string; items: Record<number, Sample<TodayStats>> }>('/today', { ids }, signal), ...polling(config.intervals.status) })
  const eligible = ids.filter(id => status.data?.[id]?.data?.supportsUsage)
  const quota = useQuery({ queryKey: ['quota', config.instanceId, eligible], queryFn: ({ signal }) => api<Record<number, Sample<Usage>>>('/quota', { ids: eligible }, signal), ...polling(config.intervals.quota), enabled: enabled && eligible.length > 0 })
  // Unknown account types stay in the requested scope; the server validates them.
  const subscriptions = preferences.subscriptions.filter(s => ids.includes(s.accountId) && (!status.data?.[s.accountId]?.data || status.data[s.accountId].data!.type === 'oauth'))
    .sort((a, b) => preferences.pins.indexOf(a.accountId) - preferences.pins.indexOf(b.accountId))
  const spendingBody = { subscriptions, timeZone: preferences.timeZone, includeAdmin: preferences.includeAdmin }
  const localDay = dateInZone(new Date(now), preferences.timeZone)
  const spending = useQuery({ queryKey: ['spending', config.instanceId, spendingBody, localDay], queryFn: ({ signal }) => api<{ day: string; rows: SpendingRow[] }>('/spending', spendingBody, signal), ...polling(config.intervals.spending), enabled: enabled && withSpending && subscriptions.length > 0 })
  const dailyBody = { ids, timeZone: preferences.timeZone, includeAdmin: preferences.includeAdmin }
  const dailyEnabled = enabled && withSpending && requestedIds !== undefined
  const dailySpending = useQuery({ queryKey: ['daily-spending', config.instanceId, dailyBody, localDay], queryFn: ({ signal }) => api<{ day: string; items: Record<number, Sample<number>> }>('/spending/today', dailyBody, signal), ...polling(config.intervals.spending), enabled: dailyEnabled })
  const refresh = async () => {
    await Promise.all([status.refetch(), today.refetch(), ...(eligible.length ? [quota.refetch()] : []), ...(subscriptions.length && withSpending ? [spending.refetch()] : []), ...(dailyEnabled ? [dailySpending.refetch()] : [])])
  }
  const nextRefreshIn = refreshCountdown(now, [
    { ...status, enabled, interval: config.intervals.status },
    { ...today, enabled, interval: config.intervals.status },
    { ...quota, enabled: enabled && eligible.length > 0, interval: config.intervals.quota },
    { ...spending, enabled: enabled && withSpending && subscriptions.length > 0, interval: config.intervals.spending },
    { ...dailySpending, enabled: dailyEnabled, interval: config.intervals.spending },
  ])
  return { status, today: { ...today, data: today.data?.day === day ? today.data : undefined }, quota,
    spending: { ...spending, data: spending.data?.day === localDay ? spending.data : undefined }, refresh, now, nextRefreshIn,
    dailySpending: { ...dailySpending, data: dailySpending.data?.day === localDay ? dailySpending.data : undefined },
    isFetching: status.isFetching || today.isFetching || quota.isFetching || spending.isFetching || dailySpending.isFetching, subscriptions }
}
export type MonitorData = ReturnType<typeof useMonitor>

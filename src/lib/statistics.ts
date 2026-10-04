import { useMemo } from 'react'
import { api } from './api'
import { useNow } from './monitor'
import { useWorkspace } from './preferences'
import { useManualQuery } from './manual-query'
import type { Account, Sample, SpendingRow } from '../../shared/domain'

export function useStatistics(near: boolean) {
  const { config, preferences } = useWorkspace()
  const now = useNow()
  const subscriptions = useMemo(() => preferences.subscriptions.filter(v => preferences.pins.includes(v.accountId)), [preferences.subscriptions, preferences.pins])
  const body = { subscriptions, timeZone: preferences.timeZone, includeAdmin: preferences.includeAdmin }
  const spending = useManualQuery<{ day: string; rows: SpendingRow[]; accounts: Record<number, Sample<Account>> }>(['statistics-spending', config.instanceId, body],
    (force, signal) => api('/statistics/spending', { ...body, force }, signal), near && subscriptions.length > 0)
  return { spending, subscriptions, now, status: { data: spending.data?.accounts, error: spending.error } }
}

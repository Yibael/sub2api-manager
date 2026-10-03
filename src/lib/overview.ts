import { sumMoney } from '../../shared/money'
import type { Account, Sample, TodayStats } from '../../shared/domain'

export function overviewTotals(ids: number[], status?: Record<number, Sample<Account>>, today?: Record<number, Sample<TodayStats>>) {
  const accounts = ids.map(id => status?.[id])
  const complete = ids.length > 0 && accounts.every(sample => sample?.data && !sample.error)
  const sumConcurrency = (field: 'currentConcurrency' | 'concurrency') => {
    if (!complete || accounts.some(sample => sample!.data![field] == null)) return null
    return accounts.reduce((total, sample) => total + sample!.data![field]!, 0)
  }
  const usage = ids.map(id => today?.[id])
  const standardUsage = ids.length > 0 && usage.every(sample => sample?.data?.standardCost != null && !sample.error)
    ? sumMoney(usage.map(sample => sample!.data!.standardCost!))
    : null
  return { concurrency: sumConcurrency('currentConcurrency'), concurrencyLimit: sumConcurrency('concurrency'), standardUsage }
}

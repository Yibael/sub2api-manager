import Decimal from 'decimal.js'
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
    ? usage.reduce((total, sample) => total.plus(sample!.data!.standardCost!), new Decimal(0)).toNumber()
    : null
  return { concurrency: sumConcurrency('currentConcurrency'), concurrencyLimit: sumConcurrency('concurrency'), standardUsage }
}

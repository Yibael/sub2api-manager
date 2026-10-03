import { describe, expect, it } from 'vitest'
import { formatMoney, normalizeMoney, sumMoney } from '../shared/money'
import { subscriptionSchema } from '../shared/domain'
import { normalizeAccount, normalizeToday, normalizeUsage } from '../server/normalize'
import { Monitor } from '../server/monitor'
import { defaultIntervals } from '../shared/domain'
import { fixtureUpstream } from './fixtures/upstream'

describe('shared decimal amounts', () => {
  it('accepts legacy numbers and decimal strings without rounding stored amounts', () => {
    expect(normalizeMoney(0.049)).toBe('0.049')
    expect(normalizeMoney('0.04900000000000000000001')).toBe('0.04900000000000000000001')
    expect(normalizeMoney(' 1.2300e2 ')).toBe('123')
    expect(subscriptionSchema.parse({ accountId: 1, price: 20, renewalDay: 1 }).price).toBe('20')
    expect(subscriptionSchema.parse({ accountId: 1, price: '20.000000000000000001', renewalDay: 1 }).price).toBe('20.000000000000000001')
  })
  it('keeps invalid or missing amounts unknown and rejects invalid subscription costs', () => {
    for (const value of [undefined, null, '', ' ', '0x10', true, '-1', 'Infinity', NaN, Infinity, '1e309']) expect(normalizeMoney(value)).toBeNull()
    for (const price of ['', '-1', 'NaN', '1000000000.000000000000000001']) expect(subscriptionSchema.safeParse({ accountId: 1, price, renewalDay: 1 }).success).toBe(false)
    expect(normalizeMoney(0)).toBe('0')
    expect(formatMoney(null)).toBeNull()
  })
  it('sums unrounded amounts and rounds half up only for display', () => {
    expect(sumMoney(['0.1', '0.2'])).toBe('0.3')
    expect(sumMoney(['1000000000.000000000000000001', '0.000000000000000001'])).toBe('1000000000.000000000000000002')
    expect(formatMoney('0.049')).toBe('0.05')
    expect(formatMoney('1.005')).toBe('1.01')
    expect(formatMoney('1.004999999999999999999')).toBe('1.00')
    expect(formatMoney('1234567.895')).toBe('1,234,567.90')
    expect(formatMoney('0')).toBe('0.00')
    expect(formatMoney(sumMoney(['0.004', '0.004']))).toBe('0.01')
  })
  it('uses decimal amounts for normalization and quota estimates', () => {
    expect(normalizeToday({ standard_cost: '0.049', cost: '0.1', user_cost: 0.2 })).toMatchObject({ standardCost: '0.049', accountCost: '0.1', userCost: '0.2' })
    const account = normalizeAccount({ id: 1, platform: 'openai', type: 'oauth' })
    const usage = normalizeUsage({ seven_day: { utilization: 25, window_stats: { cost: '0.049' } } }, account)
    expect(usage.estimatedWeeklyCost).toBe('0.196')
    expect(formatMoney(usage.estimatedWeeklyCost)).toBe('0.20')
  })
  it('preserves the same fractional amount through spending and ranking APIs', async () => {
    const amount = '0.04900000000000000000001'
    const monitor = new Monitor({ request: async (path, options) => {
      if (path === 'usage/stats') return { total_actual_cost: amount }
      if (path === 'dashboard/users-ranking') return {
        start_date: options!.query!.start_date, end_date: options!.query!.end_date, total_actual_cost: amount,
        ranking: [{ user_id: 1, actual_cost: amount, requests: 1, tokens: 100 }],
      }
      return fixtureUpstream.request(path, options)
    } }, { ...defaultIntervals }, 'UTC')
    const [spending, ranking] = await Promise.all([
      monitor.spending({ subscriptions: [{ accountId: 1, price: '20', renewalDay: 1 }], timeZone: 'UTC', includeAdmin: true }),
      monitor.rankings({ range: 'today', timeZone: 'UTC', includeAdmin: true }),
    ])
    expect(spending.rows[0].today.data).toBe(amount)
    expect(ranking.data?.rows.map(row => row.userId)).toEqual([1])
    expect(ranking.data?.rows[0].amount).toBe(amount)
    expect(ranking.data?.totalAmount).toBe(amount)
    expect(formatMoney(spending.rows[0].today.data)).toBe('0.05')
    expect(formatMoney(ranking.data?.rows[0].amount)).toBe('0.05')
    expect(JSON.parse(JSON.stringify(ranking)).data.rows[0].amount).toBe(amount)
  })
  it('orders users by full decimal amounts before applying token tie breakers', async () => {
    const monitor = new Monitor({ request: async (_path, options) => ({
      start_date: options!.query!.start_date, end_date: options!.query!.end_date,
      total_actual_cost: '0.09800000000000000000001',
      ranking: [
        { user_id: 1, actual_cost: '0.049', requests: 1, tokens: 200 },
        { user_id: 2, actual_cost: '0.04900000000000000000001', requests: 1, tokens: 100 },
      ],
    }) }, { ...defaultIntervals }, 'UTC')
    const ranking = await monitor.rankings({ range: 'today', timeZone: 'UTC', includeAdmin: true })
    expect(ranking.data?.rows.map(row => row.userId)).toEqual([2, 1])
    expect(ranking.data?.totalAmount).toBe('0.09800000000000000000001')
  })
})

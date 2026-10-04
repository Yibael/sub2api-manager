import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Monitor } from '../server/monitor'
import { UpstreamError, type Upstream } from '../server/upstream'
import { defaultIntervals, type ModelRankingsRequest } from '../shared/domain'
import { fixtureUpstream } from './fixtures/upstream'

const input: ModelRankingsRequest = { range: 'today', timeZone: 'Asia/Shanghai', includeAdmin: true }
const row = (model: string, actual_cost: number | string, requests = 10, total_tokens = 1000) => ({ model, actual_cost, requests, total_tokens })
function setup(override?: Upstream['request']) {
  const request = vi.fn<Upstream['request']>(async (path, options) => (await override?.(path, options)) ?? fixtureUpstream.request(path, options))
  return { monitor: new Monitor({ request }, { ...defaultIntervals }, 'UTC'), request,
    calls: (path: string) => request.mock.calls.filter(([value]) => value === path) }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T16:35:00Z')) })
afterEach(() => vi.useRealTimers())

describe('global model rankings', () => {
  it('uses one aggregate request for the selected period, actual consumption and complete Token counts', async () => {
    const { monitor, request } = setup(async (path, options) => path === 'dashboard/models' ? {
      start_date: options!.query!.start_date, end_date: options!.query!.end_date,
      models: [row('tokens-first', '0.2', 5, 2_000_000), row('cost-first', '9007199254740993.12345', 4, 10), row('third', '0.1')],
    } : undefined)
    const result = await monitor.modelRankings(input)
    expect(result.error).toBeNull()
    expect(result.data?.rows.map(row => row.model)).toEqual(['cost-first', 'tokens-first', 'third'])
    expect(result.data?.rows[0].amount).toBe('9007199254740993.12345')
    expect(result.data?.rows[1]).toMatchObject({ tokens: 2_000_000, requests: 5 })
    expect(result.data?.totalAmount).toBe('9007199254740993.42345')
    expect(result.data).toMatchObject({ period: '2026-10-02', timeZone: 'Asia/Shanghai' })
    expect(request).toHaveBeenCalledExactlyOnceWith('dashboard/models', expect.objectContaining({ query: {
      start_date: '2026-10-02', end_date: '2026-10-02', timezone: 'Asia/Shanghai', model_source: 'requested',
    } }))
  })
  it.each([['7d', '2026-09-26'], ['30d', '2026-09-03']] as const)('keeps %s ranges independent with inclusive natural-day bounds', async (range, startDate) => {
    const { monitor, calls } = setup()
    await monitor.modelRankings(input)
    const result = await monitor.modelRankings({ ...input, range })
    expect(result.data).toMatchObject({ range, startDate, endDate: '2026-10-02', period: `${startDate}/2026-10-02` })
    expect(calls('dashboard/models')[1][1]?.query).toMatchObject({ start_date: startDate, end_date: '2026-10-02' })
    await monitor.modelRankings(input)
    expect(calls('dashboard/models')).toHaveLength(2)
  })
  it('deducts every Admin model metric before sorting and includes undisplayed models in the total', async () => {
    const { monitor, calls } = setup(async (path, options) => {
      if (path === 'users') return { total: 2, items: [{ id: 7, role: 'admin' }, { id: 8, role: 'admin' }] }
      if (path === 'dashboard/models') return {
        start_date: options!.query!.start_date, end_date: options!.query!.end_date,
        models: options!.query!.user_id === '7' ? [row('model-0', '0.1', 1, 100)]
          : options!.query!.user_id === '8' ? [row('model-0', '0.2', 2, 200)]
          : Array.from({ length: 15 }, (_, i) => row(`model-${i}`, '1', 10, 1000 + i)),
      }
    })
    const result = await monitor.modelRankings({ ...input, includeAdmin: false })
    expect(result.data?.rows).toHaveLength(12)
    expect(result.data?.totalAmount).toBe('14.7')
    const included = await monitor.modelRankings(input)
    expect(included.data?.totalAmount).toBe('15')
    expect(calls('dashboard/models')).toHaveLength(3)
    const only = await monitor.modelRankings({ ...input, range: '7d', includeAdmin: false })
    expect(only.error).toBeNull()
    const { monitor: small } = setup(async (path, options) => path === 'dashboard/models' ? {
      start_date: options!.query!.start_date, end_date: options!.query!.end_date,
      models: [row('only', options!.query!.user_id ? '0.3' : '1', options!.query!.user_id ? 3 : 10, options!.query!.user_id ? 300 : 1000)],
    } : undefined)
    expect((await small.modelRankings({ ...input, includeAdmin: false })).data?.rows).toEqual([{ model: 'only', amount: '0.7', requests: 7, tokens: 700 }])
  })
  it('shares aggregates and Admin lookups across devices, then refreshes only the selected range', async () => {
    const { monitor, calls } = setup()
    await Promise.all(Array.from({ length: 20 }, (_, i) => monitor.modelRankings({ ...input, includeAdmin: i % 2 === 0 })))
    expect(calls('dashboard/models')).toHaveLength(2)
    expect(calls('users')).toHaveLength(1)
    await monitor.modelRankings({ ...input, range: '7d' })
    await Promise.all(Array.from({ length: 20 }, () => monitor.modelRankings({ ...input, range: '7d', force: true })))
    expect(calls('dashboard/models')).toHaveLength(4)
    expect(calls('dashboard/models').filter(([, options]) => options?.query?.start_date === options?.query?.end_date)).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(calls('dashboard/models')).toHaveLength(4)
  })
  it('returns a successful empty rank after Admin-only usage is excluded', async () => {
    const { monitor } = setup(async (path, options) => path === 'dashboard/models' ? {
      start_date: options!.query!.start_date, end_date: options!.query!.end_date, models: [row('only-admin', '0.3')],
    } : undefined)
    expect(await monitor.modelRankings({ ...input, includeAdmin: false })).toMatchObject({ data: { rows: [], totalAmount: '0' }, error: null })
  })
  it('preserves the last complete result on Admin failure, inconsistent deductions and malformed data', async () => {
    let failure = ''
    const { monitor } = setup(async (path, options) => {
      if (path === 'users' && failure === 'admins') throw new Error('Admin 名单不可用')
      if (path === 'dashboard/models' && failure === 'deduction') return {
        start_date: options!.query!.start_date, end_date: options!.query!.end_date,
        models: [row('only', options!.query!.user_id ? '2' : '1')],
      }
      if (path === 'dashboard/models' && failure === 'data') return { start_date: options!.query!.start_date, end_date: options!.query!.end_date, models: [row('invalid', '-1')] }
    })
    const selected = { ...input, includeAdmin: false }
    const original = await monitor.modelRankings(selected)
    for (const next of ['admins', 'deduction', 'data']) {
      vi.advanceTimersByTime(60_000); failure = next
      const result = await monitor.modelRankings({ ...selected, force: true })
      expect(result.data).toEqual(original.data)
      expect(result.updatedAt).toBe(original.updatedAt)
      expect(result.error).toBeTruthy()
    }
  })
  it('rejects wrong dates, duplicate models and incomplete metrics without presenting zeros', async () => {
    for (const models of [[row('duplicate', '1'), row('duplicate', '2')], [{ model: 'missing' }], [row('fractional', '1', 1.5)]]) {
      const { monitor } = setup(async (path, options) => path === 'dashboard/models' ? { start_date: options!.query!.start_date, end_date: options!.query!.end_date, models } : undefined)
      const result = await monitor.modelRankings(input)
      expect(result.data).toBeNull(); expect(result.error).toBeTruthy()
    }
    const { monitor } = setup(async path => path === 'dashboard/models' ? { start_date: '2000-01-01', end_date: '2000-01-01', models: [] } : undefined)
    expect((await monitor.modelRankings(input)).error).toMatch(/时间/)
  })
  it('respects 429 retry deadlines even for forced reads', async () => {
    const { monitor, calls } = setup(async path => { if (path === 'dashboard/models') throw new UpstreamError(429, '限流中', Date.now() + 90_000) })
    await monitor.modelRankings(input)
    vi.advanceTimersByTime(60_000)
    expect((await monitor.modelRankings({ ...input, force: true })).error).toBe('限流中')
    expect(calls('dashboard/models')).toHaveLength(1)
    vi.advanceTimersByTime(30_000)
    await monitor.modelRankings({ ...input, force: true })
    expect(calls('dashboard/models')).toHaveLength(2)
  })
})

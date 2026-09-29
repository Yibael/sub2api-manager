import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Monitor } from '../server/monitor'
import { defaultIntervals } from '../shared/domain'
import { UpstreamError } from '../server/upstream'
import type { Upstream } from '../server/upstream'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
function setup(extra?: Upstream['request']) {
  const request = vi.fn<Upstream['request']>(async (path, options) => {
    const match = /^accounts\/(\d+)$/.exec(path)
    if (match) return { id: Number(match[1]), type: Number(match[1]) === 3 ? 'apikey' : 'oauth', platform: 'openai' }
    if (path === 'users') return { total: 1, items: [{ id: 7, role: 'admin' }] }
    return extra?.(path, options)
  })
  return { request, monitor: new Monitor({ request }, { ...defaultIntervals }, 'Asia/Shanghai') }
}
describe('monitor queries', () => {
  it('has no upstream calls at construction or while idle after a request', async () => {
    const { request, monitor } = setup()
    expect(request).not.toHaveBeenCalled()
    await monitor.details([1])
    await vi.advanceTimersByTimeAsync(3600000)
    expect(request).toHaveBeenCalledTimes(1)
    await monitor.details([1])
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('shares per-account daily cache across overlapping device selections', async () => {
    const { request, monitor } = setup(async (_path, options) => ({ stats: Object.fromEntries(((options?.body as { account_ids?: number[] })?.account_ids ?? []).map(id => [id, { standard_cost: id }])) }))
    await monitor.today([1, 2])
    vi.advanceTimersByTime(1000)
    const b = await monitor.today([2, 3])
    expect(b.items[2].data?.standardCost).toBe(2)
    expect(request.mock.calls[1][1]?.body).toEqual({ account_ids: [3] })
  })
  it('invalidates today at the upstream day boundary even inside the interval', async () => {
    const { request, monitor } = setup(async () => ({ stats: { 1: { standard_cost: 1 } } }))
    vi.setSystemTime(new Date('2026-09-29T15:59:59Z'))
    expect((await monitor.today([1])).day).toBe('2026-09-29')
    vi.setSystemTime(new Date('2026-09-29T16:00:00Z'))
    expect((await monitor.today([1])).day).toBe('2026-09-30')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('does not query OAuth usage for an ordinary OpenAI API-key account', async () => {
    const { request, monitor } = setup()
    expect(await monitor.quota([3])).toEqual({})
    expect(request.mock.calls.map(call => call[0])).toEqual(['accounts/3'])
  })
  it('falls back on old servers and always uses force=false', async () => {
    const { request, monitor } = setup(async path => {
      if (path === 'accounts/usage/batch') throw new UpstreamError(404, 'not found')
      return { seven_day: { utilization: 42 } }
    })
    expect((await monitor.quota([1]))[1].data?.windows[0].percent).toBe(42)
    expect(request.mock.calls.find(call => call[0] === 'accounts/usage/batch')?.[1]?.body).toEqual({ account_ids: [1], force: false })
    expect(request.mock.calls.find(call => call[0] === 'accounts/1/usage')?.[1]?.query).toEqual({ force: 'false', source: 'active' })
  })
  it('deduplicates renewal-day spending and subtracts Admin cost exactly', async () => {
    const { request, monitor } = setup(async (_path, options) => ({ total_actual_cost: options?.query?.user_id ? '0.10' : '0.30' }))
    const input = { subscriptions: [{ accountId: 1, price: 20, renewalDay: 29 }], timeZone: 'Asia/Shanghai', includeAdmin: false }
    const result = await monitor.spending(input)
    expect(result.rows[0].today.data).toBe(0.2)
    expect(result.rows[0].today).toEqual(result.rows[0].spending)
    expect(request.mock.calls.filter(call => call[0] === 'usage/stats')).toHaveLength(2)
    await monitor.spending(input)
    expect(request.mock.calls.filter(call => call[0] === 'usage/stats')).toHaveLength(2)
    expect(request.mock.calls.some(call => call[0].includes('/usage'))).toBe(false)
  })
  it('separates Admin inclusion and timezone scopes', async () => {
    const { request, monitor } = setup(async (_path, options) => ({ total_actual_cost: options?.query?.user_id ? 1 : 4 }))
    const input = { subscriptions: [{ accountId: 1, price: 20, renewalDay: 29 }], timeZone: 'Asia/Shanghai', includeAdmin: true }
    expect((await monitor.spending(input)).rows[0].today.data).toBe(4)
    expect((await monitor.spending({ ...input, includeAdmin: false })).rows[0].today.data).toBe(3)
    await monitor.spending({ ...input, timeZone: 'UTC' })
    expect(request.mock.calls.filter(call => call[0] === 'usage/stats')).toHaveLength(4)
  })
})

describe('unified daily consumption', () => {
  it('supports accounts without subscriptions and respects the Admin switch', async () => {
    const { monitor } = setup(async (_path, options) => ({ total_actual_cost: options?.query?.user_id ? '0.10' : '0.30' }))
    const input = { ids: [1, 3], timeZone: 'Asia/Shanghai', includeAdmin: false }
    const excluded = await monitor.dailySpending(input)
    expect(excluded.items[1].data).toBe(0.2)
    expect(excluded.items[3].data).toBe(0.2)
    expect((await monitor.dailySpending({ ...input, includeAdmin: true })).items[3].data).toBe(0.3)
  })
  it('shares daily samples with cycle statistics and across devices without background polling', async () => {
    const { request, monitor } = setup(async (_path, options) => ({ total_actual_cost: options?.query?.user_id ? 1 : 4 }))
    const scope = { timeZone: 'Asia/Shanghai', includeAdmin: false }
    const cycle = await monitor.spending({ ...scope, subscriptions: [{ accountId: 1, price: 20, renewalDay: 15 }] })
    const calls = request.mock.calls.length
    expect((await monitor.dailySpending({ ...scope, ids: [1] })).items[1]).toEqual(cycle.rows[0].today)
    vi.advanceTimersByTime(1000)
    await monitor.dailySpending({ ...scope, ids: [1] })
    expect(request).toHaveBeenCalledTimes(calls)
    await vi.advanceTimersByTimeAsync(3600000)
    expect(request).toHaveBeenCalledTimes(calls)
  })
  it('does not fall back to all-user consumption when Admin enumeration fails', async () => {
    const upstream: Upstream = { request: async path => {
      if (path === 'accounts/1') return { id: 1, platform: 'openai', type: 'oauth' }
      if (path === 'users') throw new Error('unavailable')
      return { total_actual_cost: 99 }
    } }
    const monitor = new Monitor(upstream, { ...defaultIntervals }, 'UTC')
    const result = await monitor.dailySpending({ ids: [1], timeZone: 'UTC', includeAdmin: false })
    expect(result.items[1].data).toBeNull()
    expect(result.items[1].error).toBeTruthy()
  })
  it('uses the configured day boundary and never reuses a previous day sample', async () => {
    const { request, monitor } = setup(async () => ({ total_actual_cost: 1 }))
    const input = { ids: [1], timeZone: 'Asia/Shanghai', includeAdmin: true }
    vi.setSystemTime(new Date('2026-09-29T15:59:59Z'))
    expect((await monitor.dailySpending(input)).day).toBe('2026-09-29')
    vi.setSystemTime(new Date('2026-09-29T16:00:00Z'))
    expect((await monitor.dailySpending(input)).day).toBe('2026-09-30')
    expect(request.mock.calls.filter(call => call[0] === 'usage/stats')).toHaveLength(2)
  })
})

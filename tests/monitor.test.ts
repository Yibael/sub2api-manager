import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Monitor } from '../server/monitor'
import { defaultIntervals } from '../shared/domain'
import { UpstreamError } from '../server/upstream'
import type { Upstream } from '../server/upstream'
import { demoUpstream } from '../server/demo'

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
  it('hides yesterday without bypassing the interval at midnight', async () => {
    const { request, monitor } = setup(async () => ({ stats: { 1: { standard_cost: 1 } } }))
    vi.setSystemTime(new Date('2026-09-29T15:59:59Z'))
    expect((await monitor.today([1])).day).toBe('2026-09-29')
    vi.setSystemTime(new Date('2026-09-29T16:00:00Z'))
    const midnight = await monitor.today([1])
    expect(midnight.day).toBe('2026-09-30')
    expect(midnight.items[1].data).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-29T16:00:04Z'))
    expect((await monitor.today([1])).items[1].data?.standardCost).toBe(1)
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
    await monitor.quota([1])
    expect(request.mock.calls.filter(([path]) => path.endsWith('/usage'))).toHaveLength(1)
    vi.advanceTimersByTime(30000)
    await monitor.quota([1])
    expect(request.mock.calls.filter(([path]) => path.endsWith('/usage'))).toHaveLength(2)
    expect(request.mock.calls.filter(([path]) => path === 'accounts/usage/batch')).toHaveLength(1)
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
    expect(request.mock.calls.filter(call => call[0] === 'usage/stats')).toHaveLength(3)
  })
  it('shares the same total across simultaneous Admin settings and page types', async () => {
    const { request, monitor } = setup(async (_path, options) => ({ total_actual_cost: options?.query?.user_id ? '0.10' : '0.30' }))
    const scope = { timeZone: 'Asia/Shanghai', includeAdmin: false }
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => index % 2
      ? monitor.dailySpending({ ...scope, ids: [1], includeAdmin: true })
      : monitor.spending({ ...scope, subscriptions: [{ accountId: 1, price: 20, renewalDay: 29 }] })))
    expect(results).toHaveLength(20)
    expect(request.mock.calls.filter(([path]) => path === 'usage/stats')).toHaveLength(2)
    expect(request.mock.calls.filter(([path]) => path === 'accounts/1')).toHaveLength(1)
    expect(request.mock.calls.filter(([path]) => path === 'users')).toHaveLength(1)
    vi.advanceTimersByTime(14999)
    await monitor.dailySpending({ ...scope, ids: [1] })
    expect(request.mock.calls.filter(([path]) => path === 'usage/stats')).toHaveLength(2)
    vi.advanceTimersByTime(1)
    await monitor.dailySpending({ ...scope, ids: [1] })
    expect(request.mock.calls.filter(([path]) => path === 'usage/stats')).toHaveLength(4)
  })
})

describe('all upstream demand paths', () => {
  it('shares directory, status, today, quota, Admin and spending work across 20 clients at interval boundaries', async () => {
    const request = vi.fn<Upstream['request']>(demoUpstream.request)
    const monitor = new Monitor({ request }, { ...defaultIntervals }, 'Asia/Shanghai')
    const scope = { timeZone: 'Asia/Shanghai', includeAdmin: false }
    const subscriptions = [{ accountId: 1, price: 20, renewalDay: 15 }]
    const device = () => Promise.all([
      monitor.accounts(), monitor.details([1]), monitor.today([1]), monitor.quota([1]),
      monitor.spending({ ...scope, subscriptions }), monitor.dailySpending({ ...scope, ids: [1] }),
    ])
    const counts = () => Object.fromEntries([...new Set(request.mock.calls.map(([path]) => path))].map(path => [path, request.mock.calls.filter(([called]) => called === path).length]))
    await Promise.all(Array.from({ length: 20 }, device))
    expect(counts()).toEqual({ accounts: 1, 'accounts/1': 1, 'accounts/today-stats/batch': 1, 'accounts/usage/batch': 1, users: 1, 'usage/stats': 4 })
    vi.advanceTimersByTime(4999)
    await device()
    expect(request).toHaveBeenCalledTimes(9)
    vi.advanceTimersByTime(1)
    await Promise.all(Array.from({ length: 20 }, device))
    expect(counts()).toEqual({ accounts: 1, 'accounts/1': 2, 'accounts/today-stats/batch': 2, 'accounts/usage/batch': 1, users: 1, 'usage/stats': 4 })
    vi.advanceTimersByTime(10000)
    await device()
    expect(counts()).toEqual({ accounts: 1, 'accounts/1': 3, 'accounts/today-stats/batch': 3, 'accounts/usage/batch': 1, users: 2, 'usage/stats': 8 })
    vi.advanceTimersByTime(15000)
    await device()
    expect(counts()).toEqual({ accounts: 1, 'accounts/1': 4, 'accounts/today-stats/batch': 4, 'accounts/usage/batch': 2, users: 3, 'usage/stats': 12 })
    const beforeIdle = request.mock.calls.length
    await vi.advanceTimersByTimeAsync(7 * 86400000)
    expect(request).toHaveBeenCalledTimes(beforeIdle)
    expect(vi.getTimerCount()).toBe(0)
    await monitor.accounts()
    expect(counts().accounts).toBe(2)
  })
  it('coalesces overlapping concurrent quota batches per account', async () => {
    const request = vi.fn<Upstream['request']>(demoUpstream.request)
    const monitor = new Monitor({ request }, { ...defaultIntervals }, 'Asia/Shanghai')
    await Promise.all([monitor.quota([1, 2]), monitor.quota([2, 3]), monitor.quota([3, 1])])
    const ids = request.mock.calls.filter(([path]) => path === 'accounts/usage/batch')
      .flatMap(([, options]) => (options!.body as { account_ids: number[] }).account_ids)
    expect(ids.sort()).toEqual([1, 2, 3])
    expect(request.mock.calls.filter(([path]) => /^accounts\/\d+$/.test(path))).toHaveLength(3)
  })
  it('shares a paginated directory and retries a failed pagination only after its cooldown', async () => {
    let fail = true
    const request = vi.fn<Upstream['request']>(async (_path, options) => {
      const id = Number(options?.query?.page)
      if (id === 2 && fail) throw new Error('page unavailable')
      return { total: 2, items: [{ id, platform: 'openai', type: 'oauth' }] }
    })
    const monitor = new Monitor({ request }, { ...defaultIntervals }, 'UTC')
    const results = await Promise.all(Array.from({ length: 20 }, () => monitor.accounts()))
    expect(results.every(result => result.error && result.data === null)).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(59999)
    await monitor.accounts()
    expect(request).toHaveBeenCalledTimes(2)
    fail = false
    vi.advanceTimersByTime(1)
    expect((await monitor.accounts()).data).toHaveLength(2)
    expect(request).toHaveBeenCalledTimes(4)
  })
  it('does not reuse failed status data to launch dependent upstream queries', async () => {
    let failed = false
    const request = vi.fn<Upstream['request']>(async (path, options) => {
      if (failed && path === 'accounts/1') throw new Error('account unavailable')
      return demoUpstream.request(path, options)
    })
    const monitor = new Monitor({ request }, { ...defaultIntervals }, 'UTC')
    await monitor.details([1])
    failed = true
    vi.advanceTimersByTime(5000)
    const scope = { timeZone: 'UTC', includeAdmin: true }
    const [quota, spending] = await Promise.all([
      monitor.quota([1]), monitor.spending({ ...scope, subscriptions: [{ accountId: 1, price: 20, renewalDay: 15 }] }),
      monitor.dailySpending({ ...scope, ids: [1] }),
    ])
    expect(quota).toEqual({})
    expect(spending.rows[0].spending.error).toBeTruthy()
    expect(request.mock.calls.map(([path]) => path)).toEqual(['accounts/1', 'accounts/1'])
  })
  it('does not add a second TTL when another client starts using excluded-Admin consumption', async () => {
    let total = 4
    const { monitor, request } = setup(async (_path, options) => ({ total_actual_cost: options?.query?.user_id ? 1 : total }))
    const input = { ids: [1], timeZone: 'Asia/Shanghai', includeAdmin: true }
    const original = (await monitor.dailySpending(input)).items[1]
    vi.advanceTimersByTime(14000)
    expect((await monitor.dailySpending({ ...input, includeAdmin: false })).items[1].data).toBe(3)
    vi.advanceTimersByTime(1000)
    total = 8
    const renewed = (await monitor.dailySpending({ ...input, includeAdmin: false })).items[1]
    expect(renewed.data).toBe(7)
    expect(renewed.updatedAt).toBe(original.updatedAt! + 14000)
    expect(request.mock.calls.filter(([path, options]) => path === 'usage/stats' && !options?.query?.user_id)).toHaveLength(2)
  })
  it('keeps the last complete consumption projection if a component fails', async () => {
    let fail = false
    const { monitor, request } = setup(async (_path, options) => {
      if (fail && options?.query?.user_id) throw new Error('subtotal unavailable')
      return { total_actual_cost: options?.query?.user_id ? 1 : 4 }
    })
    const input = { ids: [1], timeZone: 'Asia/Shanghai', includeAdmin: false }
    const original = (await monitor.dailySpending(input)).items[1]
    fail = true
    vi.advanceTimersByTime(15000)
    const failed = (await monitor.dailySpending(input)).items[1]
    expect(failed).toEqual({ ...original, error: 'subtotal unavailable' })
    const calls = request.mock.calls.length
    await monitor.dailySpending(input)
    expect(request).toHaveBeenCalledTimes(calls)
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

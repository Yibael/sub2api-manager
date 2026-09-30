import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { DemandCache } from '../server/cache'
import { Monitor } from '../server/monitor'
import { UpstreamError } from '../server/upstream'
import { defaultIntervals } from '../shared/domain'
import { fixtureUpstream } from './fixtures/upstream'
import { forceQuery, refreshDelay } from '../src/lib/completion-query'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
describe('forced refresh', () => {
  it('bypasses fresh application samples and restarts the automatic interval at completion', async () => {
    const cache = new DemandCache<number>(), load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    await cache.get('account', 30_000, load)
    vi.advanceTimersByTime(1000)
    expect((await cache.get('account', 30_000, load)).data).toBe(1)
    expect((await cache.get('account', 30_000, load, true)).data).toBe(2)
    vi.advanceTimersByTime(29_999)
    await cache.get('account', 30_000, load)
    expect(load).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    await cache.get('account', 30_000, load)
    expect(load).toHaveBeenCalledTimes(3)
  })
  it('waits for an ordinary in-flight read, then coalesces concurrent force requests', async () => {
    const cache = new DemandCache<number>()
    let ordinaryDone!: (value: number) => void, forcedDone!: (value: number) => void
    const load = vi.fn().mockImplementationOnce(() => new Promise<number>(resolve => { ordinaryDone = resolve })).mockImplementationOnce(() => new Promise<number>(resolve => { forcedDone = resolve }))
    const ordinary = cache.get('key', 30_000, load)
    const first = cache.get('key', 30_000, load, true), second = cache.get('key', 30_000, load, true)
    expect(load).toHaveBeenCalledTimes(1)
    ordinaryDone(1); await ordinary
    expect(load).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(4000); forcedDone(2)
    expect((await first).data).toBe(2)
    expect(await second).toEqual(await first)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('does not bypass an upstream 429 cooldown', async () => {
    const cache = new DemandCache<number>(), retryAt = Date.now() + 60_000
    const load = vi.fn().mockRejectedValue(new UpstreamError(429, '冷却中', retryAt))
    await cache.get('key', 30_000, load)
    vi.advanceTimersByTime(1000)
    expect((await cache.get('key', 30_000, load, true)).error).toBe('冷却中')
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('forces only the quota upstream channel and writes back the shared result', async () => {
    const upstream = { request: vi.fn(fixtureUpstream.request) }, monitor = new Monitor(upstream, { ...defaultIntervals }, 'UTC')
    await monitor.quota([1])
    upstream.request.mockClear()
    await monitor.quota([1], true)
    expect(upstream.request).toHaveBeenCalledTimes(1)
    expect(upstream.request.mock.calls[0][0]).toBe('accounts/usage/batch')
    expect(upstream.request.mock.calls[0][1]?.body).toEqual({ account_ids: [1], force: true })
    await monitor.quota([1])
    expect(upstream.request).toHaveBeenCalledTimes(1)
  })
  it('forces consumption scopes while deduplicating Admin and identical daily/cycle reads', async () => {
    const upstream = { request: vi.fn(fixtureUpstream.request) }, monitor = new Monitor(upstream, { ...defaultIntervals }, 'UTC')
    const input = { subscriptions: [{ accountId: 1, price: 20, renewalDay: 29 }, { accountId: 2, price: 30, renewalDay: 29 }], timeZone: 'UTC', includeAdmin: false }
    await monitor.spending(input)
    upstream.request.mockClear()
    const result = await monitor.spending({ ...input, force: true })
    expect(result.rows.every(row => !row.spending.error && !row.today.error)).toBe(true)
    expect(upstream.request.mock.calls.filter(([path]) => path === 'users')).toHaveLength(1)
    const costs = upstream.request.mock.calls.filter(([path]) => path === 'usage/stats')
    expect(costs.length).toBeGreaterThan(0)
    expect(new Set(costs.map(([, options]) => JSON.stringify(options?.query))).size).toBe(costs.length)
    expect(costs.every(([, options]) => options?.query?.nocache === 'true')).toBe(true)
  })
})
describe('client completion clock and force requests', () => {
  it('starts the whole interval at completion even when a request takes longer than that interval', () => {
    const began = Date.now()
    vi.advanceTimersByTime(40_000)
    const completed = Date.now()
    expect(refreshDelay(completed, 30)).toBe(30_000)
    expect(refreshDelay(began, 30)).toBe(0)
    vi.advanceTimersByTime(29_999)
    expect(refreshDelay(completed, 30)).toBe(1)
  })
  it('bypasses QueryClient freshness, coalesces manual requests, and records their end time', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), key = ['quota-force-test']
    client.setQueryData(key, 'cached')
    let complete!: (value: string) => void
    const load = vi.fn(() => new Promise<string>(resolve => { complete = resolve }))
    const a = forceQuery(client, key, load), b = forceQuery(client, key, load)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(4000); complete('fresh')
    expect(await a).toBe('fresh'); expect(await b).toBe('fresh')
    expect(client.getQueryData(key)).toBe('fresh')
    expect(refreshDelay(client.getQueryState(key)!.dataUpdatedAt, 30)).toBe(30_000)
    client.clear()
  })
})

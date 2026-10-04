import { afterEach, describe, expect, it, vi } from 'vitest'
import { Monitor } from '../server/monitor'
import { defaultIntervals } from '../shared/domain'
import { fixtureUpstream } from './fixtures/upstream'
import { manualQueryOptions } from '../src/lib/manual-query'
import { QueryClient } from '@tanstack/react-query'

afterEach(() => vi.useRealTimers())
describe('statistics manual refresh', () => {
  it('keeps all statistics snapshot policies independent of configured polling intervals', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T06:00:00Z'))
    const request = vi.fn(fixtureUpstream.request)
    const monitor = new Monitor({ request }, { ...defaultIntervals }, 'UTC')
    const input = { range: 'today' as const, timeZone: 'UTC', includeAdmin: false }
    const spending = { subscriptions: [{ accountId: 1, price: '20', renewalDay: 29 }], timeZone: 'UTC', includeAdmin: false }
    await monitor.rankings(input); await monitor.modelRankings(input); await monitor.spending(spending, true)
    expect(request.mock.calls.filter(([path]) => path === 'users')).toHaveLength(1)
    monitor.intervals = { status: 30, quota: 120, spending: 120 }
    vi.advanceTimersByTime(31_000)
    const before = request.mock.calls.length
    await monitor.rankings(input); await monitor.modelRankings(input); await monitor.spending(spending, true)
    expect(request.mock.calls.length).toBeGreaterThan(before)
    const paths = request.mock.calls.slice(before).map(([path]) => path)
    expect(paths).toContain('dashboard/users-ranking'); expect(paths).toContain('dashboard/models')
    expect(paths).toContain('accounts/1'); expect(paths).toContain('usage/stats'); expect(paths).toContain('users')
    const count = request.mock.calls.length
    await vi.advanceTimersByTimeAsync(24 * 3600000)
    expect(request).toHaveBeenCalledTimes(count)
    await monitor.spending({ ...spending, force: true }, true)
    expect(request.mock.calls.length).toBeGreaterThan(count)
  })
  it('disables timer, focus, reconnect and invalidation-driven fetches for statistics data', async () => {
    const load = vi.fn(async () => ({ total: '1.25' }))
    const client = new QueryClient()
    const options = manualQueryOptions(['statistics-spending', 'test'], load)
    expect(options).toMatchObject({ enabled: false, staleTime: Infinity, retry: false,
      refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, meta: { poll: false } })
    await client.fetchQuery(options)
    await client.invalidateQueries({ queryKey: ['statistics-spending'] })
    expect(load).toHaveBeenCalledTimes(1)
    client.clear()
  })
})

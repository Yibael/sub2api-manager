import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Monitor } from '../server/monitor'
import { defaultIntervals, hourInZone, userRankingPeriod, type RankingRange, type UserRankingsRequest } from '../shared/domain'
import type { Upstream } from '../server/upstream'
import { fixtureUpstream } from './fixtures/upstream'

const input: UserRankingsRequest = { range: 'today', timeZone: 'Asia/Shanghai', includeAdmin: false }
const hourly: UserRankingsRequest = { ...input, range: 'hour' }
const row = (id: number, amount = id) => ({ user_id: id, username: `用户 ${id}`, actual_cost: amount, requests: id, tokens: id * 100 })
function setup(override?: Upstream['request']) {
  const request = vi.fn<Upstream['request']>(async (path, options) => (await override?.(path, options)) ?? fixtureUpstream.request(path, options))
  const monitor = new Monitor({ request }, { ...defaultIntervals }, 'Asia/Shanghai')
  const calls = (path: string) => request.mock.calls.filter(([value]) => value === path)
  return { monitor, request, calls }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:35:00Z')) })
afterEach(() => vi.useRealTimers())

describe('selectable upstream user consumption rankings', () => {
  it('queries only the selected period, using the direct daily rank without usage logs or account requests', async () => {
    const { monitor, request, calls } = setup()
    const result = await monitor.rankings(input)
    expect(result.data?.rows.map(row => [row.userId, row.amount])).toEqual([[11, '12.84'], [12, '8.26'], [13, '3.18'], [14, '1.32']])
    expect(result.data).toMatchObject({ range: 'today', period: '2026-10-01', startDate: '2026-10-01', endDate: '2026-10-01' })
    expect(result.data?.totalAmount).toBe('25.6')
    expect(calls('dashboard/users-ranking')[0][1]?.query).toEqual({ start_date: '2026-10-01', end_date: '2026-10-01', timezone: 'Asia/Shanghai', limit: '50' })
    expect(request.mock.calls.map(([path]) => path).sort()).toEqual(['dashboard/users-ranking', 'users'])
    const hour = await monitor.rankings(hourly)
    expect(hour.data?.rows.map(row => [row.userId, row.amount])).toEqual([[12, '0.86'], [11, '0.42'], [13, '0.18']])
    expect(hour.data?.period).toBe('2026-10-01 20:00')
    expect(hour.data?.totalAmount).toBe('1.46')
    expect(calls('dashboard/users-ranking')).toHaveLength(1)
  })
  it.each<[RankingRange, string]>([['7d', '2026-09-25'], ['30d', '2026-09-02']])('requests %s with inclusive natural-day bounds and keeps its cache separate', async (range, startDate) => {
    const { monitor, calls } = setup()
    const today = await monitor.rankings(input)
    const result = await monitor.rankings({ ...input, range })
    expect(result.data).toMatchObject({ range, startDate, endDate: '2026-10-01', period: `${startDate}/2026-10-01` })
    expect(calls('dashboard/users-ranking')[1][1]?.query).toMatchObject({ start_date: startDate, end_date: '2026-10-01' })
    expect(result.data?.rows[0].amount).toBe(String(12.84 * (range === '7d' ? 7 : 30)))
    expect(Number(result.data?.totalAmount)).toBeCloseTo(25.6 * (range === '7d' ? 7 : 30), 10)
    expect((await monitor.rankings(input)).data).toEqual(today.data)
    expect(calls('dashboard/users-ranking')).toHaveLength(2)
  })
  it('calculates calendar bounds across years, leap days and daylight-saving changes', () => {
    expect(userRankingPeriod('7d', new Date('2026-01-01T12:00:00Z'), 'Asia/Shanghai', 'UTC').startDate).toBe('2025-12-26')
    expect(userRankingPeriod('30d', new Date('2024-03-01T12:00:00Z'), 'UTC', 'UTC').startDate).toBe('2024-02-01')
    expect(userRankingPeriod('7d', new Date('2026-03-10T04:00:00Z'), 'America/New_York', 'UTC')).toMatchObject({ startDate: '2026-03-04', endDate: '2026-03-10' })
  })
  it('honors inclusion, name fallbacks and deterministic actual-cost ordering', async () => {
    const { monitor, calls } = setup(async (path, options) => path === 'dashboard/users-ranking' ? {
      start_date: options!.query!.start_date, end_date: options!.query!.end_date,
      total_actual_cost: 0.3,
      ranking: [row(3, 0.1), { ...row(2, 0.1), username: '', email: 'user@example.test', tokens: 300 },
        { ...row(1, 0.1), username: '', tokens: 300, actual_cost: '0.10' }],
    } : undefined)
    const result = await monitor.rankings({ ...input, includeAdmin: true })
    expect(result.data?.rows.map(row => [row.userId, row.name])).toEqual([[1, '用户 #1'], [2, 'user@example.test'], [3, '用户 3']])
    expect((await monitor.rankings({ ...hourly, includeAdmin: true })).data?.rows[0].userId).toBe(7)
    expect(calls('users')).toHaveLength(0)
  })
  it('uses the upstream full-range total even when only 50 users are returned and 12 displayed', async () => {
    const { monitor, request } = setup(async (path, options) => path === 'dashboard/users-ranking' ? {
      start_date: options!.query!.start_date, end_date: options!.query!.end_date,
      total_actual_cost: '5000.30', ranking: Array.from({ length: 50 }, (_, i) => row(i + 1, 1)),
    } : undefined)
    const result = await monitor.rankings({ ...input, includeAdmin: true })
    expect(result.data?.rows).toHaveLength(12)
    expect(result.data?.totalAmount).toBe('5000.3')
    expect(request.mock.calls.map(([path]) => path)).toEqual(['dashboard/users-ranking'])
  })
  it('deducts Admins outside the returned rank and shares their aggregate costs across devices', async () => {
    const { monitor, calls } = setup(async (path, options) => {
      if (path === 'users') return { total: 2, items: [{ id: 11, role: 'admin' }, { id: 999, role: 'admin' }] }
      if (path === 'dashboard/users-ranking') return {
        start_date: options!.query!.start_date, end_date: options!.query!.end_date,
        total_actual_cost: '101.30', ranking: Array.from({ length: 50 }, (_, i) => row(i + 11, 2)),
      }
      if (path === 'usage/stats') return { total_actual_cost: '0.30' }
    })
    const selected = { ...input, range: '7d' as const }
    const results = await Promise.all(Array.from({ length: 20 }, () => monitor.rankings(selected)))
    expect(results.every(result => result.data?.totalAmount === '99')).toBe(true)
    expect(results[0].data?.rows.every(row => row.userId !== 11 && row.userId !== 999)).toBe(true)
    expect(calls('usage/stats')).toHaveLength(1)
    expect(calls('usage/stats')[0][1]?.query).toEqual({ start_date: '2026-09-25', end_date: '2026-10-01', timezone: 'Asia/Shanghai', user_id: '999', nocache: 'true' })
    expect((await monitor.rankings({ ...selected, includeAdmin: true })).data?.totalAmount).toBe('101.3')
    await monitor.rankings(selected)
    expect(calls('usage/stats')).toHaveLength(1)
    await monitor.rankings({ ...selected, force: true })
    expect(calls('usage/stats')).toHaveLength(2)
  })
  it('sums every eligible current-hour user before limiting the displayed rank', async () => {
    const { monitor, request } = setup(async path => path === 'dashboard/users-trend' ? {
      start_date: '2026-10-01', end_date: '2026-10-01', granularity: 'hour', trend: [
        ...Array.from({ length: 15 }, (_, i) => ({ ...row(i + 11, 0.1), date: '2026-10-01 20:00' })),
        { ...row(7, 0.8), date: '2026-10-01 20:00' },
        { ...row(500, 1000), date: '2026-10-01 19:00' },
      ],
    } : undefined)
    const excluded = await monitor.rankings(hourly)
    expect(excluded.data?.rows).toHaveLength(12)
    expect(excluded.data?.totalAmount).toBe('1.5')
    expect((await monitor.rankings({ ...hourly, includeAdmin: true })).data?.totalAmount).toBe('2.3')
    expect(request.mock.calls.every(([path]) => ['users', 'dashboard/users-trend'].includes(path))).toBe(true)
  })
  it('preserves the last complete rank and total when a missing Admin aggregate fails', async () => {
    let fail = false
    const { monitor } = setup(async (path, options) => {
      if (path === 'dashboard/users-ranking') return { start_date: options!.query!.start_date, end_date: options!.query!.end_date, total_actual_cost: 10, ranking: [row(11, 2)] }
      if (path === 'usage/stats') { if (fail) throw new Error('Admin 消费暂不可用'); return { total_actual_cost: 1 } }
    })
    const previous = await monitor.rankings(input)
    expect(previous.data?.totalAmount).toBe('9')
    fail = true
    const result = await monitor.rankings({ ...input, force: true })
    expect(result.data).toEqual(previous.data)
    expect(result.error).toBe('Admin 消费暂不可用')
  })
  it('rejects missing or invalid upstream totals and preserves the previous complete result', async () => {
    for (const value of [undefined, -1, NaN, Infinity, 'invalid']) {
      let fail = false
      const { monitor } = setup(async (path, options) => fail && path === 'dashboard/users-ranking' ? {
        start_date: options!.query!.start_date, end_date: options!.query!.end_date, total_actual_cost: value, ranking: [],
      } : undefined)
      const previous = await monitor.rankings({ ...input, includeAdmin: true })
      fail = true
      const result = await monitor.rankings({ ...input, includeAdmin: true, force: true })
      expect(result.data).toEqual(previous.data)
      expect(result.error).toBeTruthy()
    }
  })
  it('shows zero only for a valid empty range and fails closed on inconsistent Admin deductions', async () => {
    const { monitor } = setup(async (path, options) => {
      if (path === 'dashboard/users-ranking') return { start_date: options!.query!.start_date, end_date: options!.query!.end_date, total_actual_cost: 0, ranking: [] }
      if (path === 'usage/stats') return { total_actual_cost: 1 }
    })
    expect((await monitor.rankings({ ...input, includeAdmin: true })).data).toMatchObject({ totalAmount: '0', rows: [] })
    const excluded = await monitor.rankings(input)
    expect(excluded.data).toBeNull()
    expect(excluded.error).toMatch(/口径不一致/)
  })
  it('expands whole-day token selections so a low-token user can lead the hourly cost rank', async () => {
    const { monitor, calls } = setup(async (path, options) => path === 'dashboard/users-trend' ? {
      start_date: '2026-10-01', end_date: '2026-10-01', granularity: 'hour',
      trend: Array.from({ length: Math.min(101, Number(options!.query!.limit)) }, (_, i) => ({ ...row(i + 1, i === 100 ? 999 : 1), date: i === 100 ? '2026-10-01 20:00' : '2026-10-01 19:00' })),
    } : undefined)
    const result = await monitor.rankings(hourly)
    expect(calls('dashboard/users-trend').map(call => call[1]?.query?.limit)).toEqual(['100', '1000'])
    expect(result.data?.rows.map(row => row.userId)).toEqual([101])
    expect(calls('dashboard/users-ranking')).toHaveLength(0)
  })
  it('rejects a still-truncated user range instead of displaying an incomplete hourly rank', async () => {
    const { monitor } = setup(async (path, options) => path === 'dashboard/users-trend' ? {
      start_date: '2026-10-01', end_date: '2026-10-01', granularity: 'hour',
      trend: Array.from({ length: Number(options!.query!.limit) }, (_, i) => ({ ...row(i + 1), date: '2026-10-01 20:00' })),
    } : undefined)
    const result = await monitor.rankings(hourly)
    expect(result.data).toBeNull(); expect(result.error).toMatch(/不完整/)
    expect((await monitor.rankings(input)).data?.rows).toHaveLength(4)
  })
  it('fills the top 12 from complete aggregates when excluded Admins occupy most of the upstream top 50', async () => {
    const { monitor, calls } = setup(async (path, options) => {
      const query = options!.query!
      if (path === 'users') return { total: 40, items: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, role: 'admin' })) }
      if (path === 'dashboard/users-ranking') return { start_date: query.start_date, end_date: query.end_date, total_actual_cost: 4015, ranking: Array.from({ length: 50 }, (_, i) => row(i + 1, 100 - i)) }
      if (path === 'dashboard/users-trend') return {
        start_date: query.start_date, end_date: query.end_date, granularity: 'day',
        trend: Array.from({ length: 55 }, (_, i) => ({ ...row(i + 1, 100 - i), date: query.start_date })),
      }
    })
    const result = await monitor.rankings({ ...input, range: '7d' })
    expect(result.data?.rows.map(row => row.userId)).toEqual(Array.from({ length: 12 }, (_, i) => i + 41))
    expect(result.data?.totalAmount).toBe('795')
    expect(calls('dashboard/users-trend')[0][1]?.query).toMatchObject({ granularity: 'day', start_date: '2026-09-25', end_date: '2026-10-01' })
  })
  it('combines a user across multiple aggregate days exactly in the Admin fallback', async () => {
    const { monitor } = setup(async (path, options) => {
      const query = options!.query!
      if (path === 'users') return { total: 50, items: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, role: 'admin' })) }
      if (path === 'dashboard/users-ranking') return { start_date: query.start_date, end_date: query.end_date, total_actual_cost: 1275.3, ranking: Array.from({ length: 50 }, (_, i) => row(i + 1)) }
      if (path === 'dashboard/users-trend') return { start_date: query.start_date, end_date: query.end_date, granularity: 'day', trend: [
        { ...row(100), actual_cost: '0.1', date: query.start_date }, { ...row(100), actual_cost: '0.2', date: query.end_date },
      ] }
    })
    const result = await monitor.rankings({ ...input, range: '30d' })
    expect(result.data?.rows).toHaveLength(1)
    expect(result.data?.rows[0]).toMatchObject({ userId: 100, amount: '0.3', requests: 200, tokens: 20000 })
    expect(result.data?.totalAmount).toBe('0.3')
  })
  it('keeps hourly buckets in upstream timezone while calendar-day ranges use the preference', async () => {
    vi.setSystemTime(new Date('2026-10-01T16:30:00Z'))
    const { monitor, calls } = setup()
    expect((await monitor.rankings({ ...input, timeZone: 'UTC' })).data?.period).toBe('2026-10-01')
    expect((await monitor.rankings({ ...hourly, timeZone: 'UTC' })).data?.period).toBe('2026-10-02 00:00')
    expect(calls('dashboard/users-trend')[0][1]?.query).toMatchObject({ start_date: '2026-10-02', end_date: '2026-10-02', timezone: 'Asia/Shanghai' })
    expect(hourInZone(new Date('2026-10-01T16:00:00Z'), 'Asia/Shanghai')).toBe('2026-10-02 00:00')
  })
  it('returns an empty hour only after a successful complete query, without carrying over the previous hour', async () => {
    const { monitor } = setup(async path => path === 'dashboard/users-trend' ? {
      start_date: '2026-10-01', end_date: '2026-10-01', granularity: 'hour', trend: [{ ...row(11), date: '2026-10-01 19:00' }],
    } : undefined)
    expect(await monitor.rankings(hourly)).toMatchObject({ data: { rows: [], totalAmount: '0', period: '2026-10-01 20:00' }, error: null })
  })
  it.each<RankingRange>(['hour', 'today', '7d', '30d'])('shares %s aggregates and Admin lookups across devices and inclusion settings', async range => {
    const { monitor, calls } = setup()
    await Promise.all(Array.from({ length: 20 }, (_, i) => monitor.rankings({ ...input, range, includeAdmin: i % 2 === 0 })))
    expect(calls('dashboard/users-ranking')).toHaveLength(range === 'hour' ? 0 : 1)
    expect(calls('dashboard/users-trend')).toHaveLength(range === 'hour' ? 1 : 0)
    expect(calls('users')).toHaveLength(1)
  })
  it('measures the 30-second minimum cache interval from completion and performs no background refresh', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const { monitor, calls } = setup(async path => { if (path.startsWith('dashboard/')) await pending })
    const initial = monitor.rankings(input)
    await vi.waitFor(() => expect(calls('dashboard/users-ranking')).toHaveLength(1))
    vi.advanceTimersByTime(10_000); release(); await initial
    vi.advanceTimersByTime(29_999); await monitor.rankings(input)
    expect(calls('dashboard/users-ranking')).toHaveLength(1)
    vi.advanceTimersByTime(1); await monitor.rankings(input)
    expect(calls('dashboard/users-ranking')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(calls('dashboard/users-ranking')).toHaveLength(2)
    expect(calls('dashboard/users-trend')).toHaveLength(0)
  })
  it('forces only the selected range, deduplicates force refreshes and preserves failure backoff', async () => {
    let fail = false
    const { monitor, calls } = setup(async path => { if (fail && path === 'dashboard/users-trend') throw new Error('上游暂不可用') })
    await monitor.rankings({ ...input, includeAdmin: true })
    const original = await monitor.rankings({ ...hourly, includeAdmin: true })
    await Promise.all(Array.from({ length: 20 }, () => monitor.rankings({ ...hourly, includeAdmin: true, force: true })))
    expect(calls('dashboard/users-ranking')).toHaveLength(1)
    expect(calls('dashboard/users-trend')).toHaveLength(2)
    fail = true
    const result = await monitor.rankings({ ...hourly, includeAdmin: true, force: true })
    expect(result.data).toEqual(original.data); expect(result.error).toBe('上游暂不可用')
    expect((await monitor.rankings({ ...input, includeAdmin: true })).error).toBeNull()
    await monitor.rankings({ ...hourly, includeAdmin: true, force: true })
    expect(calls('dashboard/users-trend')).toHaveLength(3)
  })
  it('fails closed on an incomplete Admin directory and preserves the last valid excluded ranking', async () => {
    let fail = false
    const { monitor } = setup(async path => { if (fail && path === 'users') return { total: 2, items: [{ id: 7, role: 'admin' }] } })
    const original = await monitor.rankings(input)
    fail = true
    const result = await monitor.rankings({ ...input, force: true })
    expect(result.data).toEqual(original.data); expect(result.error).toMatch(/Admin 名单/)
    expect((await monitor.rankings({ ...input, includeAdmin: true })).error).toBeNull()
  })
  it('rejects invalid costs, duplicate users, mismatched range dates and duplicate hour points', async () => {
    for (const ranking of [[{ ...row(1), actual_cost: -1 }], [row(1), row(1)]]) {
      const { monitor } = setup(async path => path === 'dashboard/users-ranking' ? { start_date: '2026-10-01', end_date: '2026-10-01', total_actual_cost: 1, ranking } : undefined)
      const result = await monitor.rankings(input)
      expect(result.data).toBeNull(); expect(result.error).toBeTruthy()
      expect((await monitor.rankings(hourly)).error).toBeNull()
    }
    const { monitor } = setup(async path => path === 'dashboard/users-ranking' ? { start_date: '2026-10-01', end_date: '2026-10-01', ranking: [] } : undefined)
    expect((await monitor.rankings({ ...input, range: '7d' })).error).toMatch(/格式不兼容/)
    const duplicate = setup(async path => path === 'dashboard/users-trend' ? { start_date: '2026-10-01', end_date: '2026-10-01', granularity: 'hour', trend: [{ ...row(1), date: '2026-10-01 20:00' }, { ...row(1), date: '2026-10-01 20:00' }] } : undefined)
    expect((await duplicate.monitor.rankings(hourly)).error).toMatch(/重复/)
  })
  it('does not relabel the previous range when a midnight query fails', async () => {
    let fail = false
    const { monitor } = setup(async path => { if (fail && path.startsWith('dashboard/')) throw new Error('暂不可用') })
    vi.setSystemTime(new Date('2026-10-01T15:59:59Z'))
    for (const range of ['hour', 'today', '7d', '30d'] as const) await monitor.rankings({ ...input, range })
    vi.advanceTimersByTime(1000); fail = true
    for (const range of ['hour', 'today', '7d', '30d'] as const) expect((await monitor.rankings({ ...input, range })).data).toBeNull()
  })
})

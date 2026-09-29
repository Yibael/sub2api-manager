import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DemandCache } from '../server/cache'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000) })
afterEach(() => vi.useRealTimers())
describe('shared demand cache', () => {
  it('serves device B from device A’s cache until five seconds after completion', async () => {
    const cache = new DemandCache<number>(), load = vi.fn().mockResolvedValueOnce(42).mockResolvedValueOnce(43)
    expect((await cache.get('account:1', 5000, load)).data).toBe(42)
    vi.setSystemTime(2000)
    expect(await cache.get('account:1', 5000, load)).toEqual({ data: 42, updatedAt: 1000, error: null })
    vi.setSystemTime(5999)
    await cache.get('account:1', 5000, load)
    expect(load).toHaveBeenCalledTimes(1)
    vi.setSystemTime(6000)
    expect((await cache.get('account:1', 5000, load)).data).toBe(43)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('does not query again after every device closes, however much time passes', async () => {
    const cache = new DemandCache<number>(), load = vi.fn().mockResolvedValue(1)
    await cache.get('account', 5000, load)
    await vi.advanceTimersByTimeAsync(7 * 86400000)
    expect(load).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('joins concurrent requests and starts the interval at completion', async () => {
    let finish!: (value: number) => void
    const load = vi.fn(() => new Promise<number>(resolve => { finish = resolve }))
    const cache = new DemandCache<number>()
    const a = cache.get('key', 5000, load), b = cache.get('key', 5000, load)
    expect(load).toHaveBeenCalledTimes(1)
    vi.setSystemTime(4000); finish(12)
    expect(await a).toEqual(await b)
    vi.setSystemTime(8999); await cache.get('key', 5000, load)
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('shares overlapping account batches while only loading the missing accounts', async () => {
    let finish!: (value: Map<string, number>) => void
    const first = vi.fn(() => new Promise<Map<string, number>>(resolve => { finish = resolve }))
    const cache = new DemandCache<number>()
    const a = cache.getMany(['1', '2'], 5000, first)
    const second = vi.fn(async keys => new Map<string, number>(keys.map((key: string) => [key, 30])))
    const b = cache.getMany(['2', '3'], 5000, second)
    expect(second).toHaveBeenCalledWith(['3'])
    finish(new Map([['1', 10], ['2', 20]]))
    await a
    expect((await b)['2'].data).toBe(20)
  })
  it('keeps last successful data after failure without background retries', async () => {
    const load = vi.fn().mockResolvedValueOnce(7).mockRejectedValue(new Error('上游不可用'))
    const cache = new DemandCache<number>()
    await cache.get('key', 5000, load)
    vi.setSystemTime(6000)
    expect(await cache.get('key', 5000, load)).toEqual({ data: 7, updatedAt: 1000, error: '上游不可用' })
    vi.setSystemTime(6001); await cache.get('key', 5000, load)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(load).toHaveBeenCalledTimes(2)
    await cache.get('key', 5000, load)
    expect(load).toHaveBeenCalledTimes(3)
  })
  it('does not turn a first failure or missing batch entry into zero', async () => {
    const cache = new DemandCache<number>()
    expect((await cache.getMany(['missing'], 5000, async () => new Map())).missing).toEqual({ data: null, updatedAt: null, error: '响应缺少所需数据' })
  })
  it('changing intervals uses the original completion timestamp without clearing data', async () => {
    const load = vi.fn().mockResolvedValue(1), cache = new DemandCache<number>()
    await cache.get('key', 30000, load)
    vi.setSystemTime(7000)
    await cache.get('key', 5000, load)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('rejects over-capacity batches without stranding any in-flight placeholders', async () => {
    const cache = new DemandCache<number>(1), load = vi.fn().mockResolvedValue(9)
    await expect(cache.getMany(['1', '2'], 5000, async () => new Map())).rejects.toThrow('查询范围过多')
    expect((await cache.get('1', 5000, load)).data).toBe(9)
    expect(load).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUpstream } from '../server/upstream'
import { DemandCache } from '../server/cache'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('upstream transport', () => {
  it('sends an explicit POST refresh without a fabricated request body', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ code: 0, data: { fetched_at: 1 } }))
    vi.stubGlobal('fetch', fetch)
    await createUpstream('https://upstream.example', 'key').request('openai/accounts/1/quota/refresh', { method: 'POST' })
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: undefined, redirect: 'manual' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('sends explicit PUT mutations once with their JSON body', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ code: 0, data: { id: 1, rate_multiplier: 0.125 } }))
    vi.stubGlobal('fetch', fetch)
    await createUpstream('https://upstream.example', 'key').request('groups/1', { method: 'PUT', body: { rate_multiplier: 0.125 } })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: '{"rate_multiplier":0.125}', headers: { 'Content-Type': 'application/json' }, redirect: 'manual' })
  })
  it('normalizes subpaths, adds the key server-side and never follows redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { ok: true } })))
    vi.stubGlobal('fetch', fetch)
    await createUpstream('https://upstream.example/sub/api/v1/admin/', 'server-only-key').request('accounts', { query: { page: '1' } })
    expect(String(fetch.mock.calls[0][0])).toBe('https://upstream.example/sub/api/v1/admin/accounts?page=1')
    expect(fetch.mock.calls[0][1].redirect).toBe('manual')
    expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('server-only-key')
  })
  it('does not leak upstream response bodies through errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PRIVATE TOKEN IN UPSTREAM BODY', { status: 500 })))
    await expect(createUpstream('https://upstream.example', 'key').request('accounts')).rejects.toThrow('sub2api 请求失败（500）')
  })
  it('bounds concurrency across simultaneous callers', async () => {
    const complete: (() => void)[] = []
    const fetch = vi.fn(() => new Promise<Response>(resolve => { complete.push(() => resolve(new Response(JSON.stringify({ code: 0, data: [] })))) }))
    vi.stubGlobal('fetch', fetch)
    const upstream = createUpstream('https://upstream.example', 'key')
    const requests = Array.from({ length: 6 }, () => upstream.request('accounts'))
    expect(fetch).toHaveBeenCalledTimes(4)
    complete[0](); await requests[0]
    expect(fetch).toHaveBeenCalledTimes(5)
    complete[1](); await requests[1]
    expect(fetch).toHaveBeenCalledTimes(6)
    complete.slice(2).forEach(finish => finish())
    await Promise.all(requests)
  })
  it('requires an explicit opt-in for HTTP and rejects credentials embedded in URLs', () => {
    expect(() => createUpstream('http://upstream.example', 'key')).toThrow('ALLOW_HTTP_UPSTREAM')
    expect(() => createUpstream('https://user:password@upstream.example', 'key')).toThrow('格式无效')
  })
  it.each(['60', 'Tue, 29 Sep 2026 12:01:00 GMT'])('honors Retry-After %s across paths without detached retries', async retryAfter => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': retryAfter } }))
      .mockImplementation(async () => new Response(JSON.stringify({ code: 0, data: [] })))
    vi.stubGlobal('fetch', fetch)
    const upstream = createUpstream('https://upstream.example', 'key'), cache = new DemandCache<unknown>()
    const load = vi.fn(() => upstream.request('accounts/1'))
    expect((await cache.get('1', 5000, load)).error).toBeTruthy()
    vi.advanceTimersByTime(5000)
    await cache.get('1', 5000, load)
    expect(load).toHaveBeenCalledTimes(1)
    await expect(upstream.request('accounts/2')).rejects.toMatchObject({ status: 429 })
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(55000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await cache.get('1', 5000, load)).data).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('rejects queued work after 429 instead of draining it into the upstream', async () => {
    const complete: ((response: Response) => void)[] = []
    const fetch = vi.fn(() => new Promise<Response>(resolve => complete.push(resolve)))
    vi.stubGlobal('fetch', fetch)
    const upstream = createUpstream('https://upstream.example', 'key')
    const all = Promise.allSettled(Array.from({ length: 8 }, (_, id) => upstream.request(`accounts/${id}`)))
    expect(fetch).toHaveBeenCalledTimes(4)
    complete[0](new Response('', { status: 429 }))
    complete.slice(1).forEach(finish => finish(new Response(JSON.stringify({ code: 0, data: [] }))))
    const results = await all
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(5)
  })
  it('never sends aborted work, including callers waiting for a concurrency slot', async () => {
    const complete: (() => void)[] = []
    const fetch = vi.fn(() => new Promise<Response>(resolve => complete.push(() => resolve(new Response(JSON.stringify({ code: 0, data: [] }))))))
    vi.stubGlobal('fetch', fetch)
    const upstream = createUpstream('https://upstream.example', 'key')
    await expect(upstream.request('accounts', { signal: AbortSignal.abort() })).rejects.toThrow('超时')
    expect(fetch).not.toHaveBeenCalled()
    const running = Array.from({ length: 4 }, () => upstream.request('accounts'))
    const controller = new AbortController()
    const waiting = upstream.request('users', { signal: controller.signal })
    const rejected = expect(waiting).rejects.toThrow('超时')
    controller.abort()
    await rejected
    complete.forEach(finish => finish())
    await Promise.all(running)
    expect(fetch).toHaveBeenCalledTimes(4)
    const next = upstream.request('accounts')
    complete[4]()
    await next
    expect(fetch).toHaveBeenCalledTimes(5)
  })
})

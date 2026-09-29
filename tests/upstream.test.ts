import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUpstream } from '../server/upstream'

afterEach(() => vi.unstubAllGlobals())
describe('upstream transport', () => {
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
})

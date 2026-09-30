import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, lockSession, pageSession, queryClient } from '../src/lib/api'

beforeEach(() => {
  pageSession.clear(); queryClient.clear()
  vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) })
  vi.stubGlobal('document', { visibilityState: 'visible' })
})
afterEach(() => { pageSession.clear(); queryClient.clear(); vi.unstubAllGlobals() })
describe('locked API responses', () => {
  it('clears protected queries and rejects a response that completes after the page locks', async () => {
    pageSession.activate('a'.repeat(64), pageSession.epoch)
    queryClient.setQueryData(['workspace', 'test'], { subscriptions: ['private'] })
    queryClient.setQueryData(['config'], { authenticated: true, serverUrl: 'private-origin' })
    let complete!: (value: Response) => void
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(resolve => { complete = resolve }))
    vi.stubGlobal('fetch', fetch)
    const pending = api('/workspace')
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ 'x-page-session': 'a'.repeat(64) })
    lockSession()
    complete(Response.json({ subscriptions: ['old-private-data'] }))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(queryClient.getQueryData(['workspace', 'test'])).toBeUndefined()
    expect(queryClient.getQueryData(['config'])).toMatchObject({ authenticated: false, serverUrl: '' })
    expect(navigator.sendBeacon).toHaveBeenCalledOnce()
  })
  it('does not let an old 401 response lock a newer successful login', async () => {
    pageSession.activate('a'.repeat(64), pageSession.epoch)
    let complete!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve })))
    const pending = api('/workspace')
    lockSession(); pageSession.activate('b'.repeat(64), pageSession.epoch)
    complete(Response.json({ error: 'expired' }, { status: 401 }))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(pageSession.token).toBe('b'.repeat(64))
  })
  it('revokes a late login result instead of restoring a closed page', async () => {
    let complete!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve })))
    const pending = api('/login', { password: 'test-only-password' })
    lockSession(); complete(Response.json({ pageToken: 'a'.repeat(64) }))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(pageSession.unlocked).toBe(false)
    expect(navigator.sendBeacon).toHaveBeenCalledOnce()
  })
})

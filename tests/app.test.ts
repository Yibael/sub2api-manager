import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../server/app'
import { Monitor } from '../server/monitor'
import { defaultIntervals } from '../shared/domain'
import { demoUpstream } from '../server/demo'

function setup() {
  const upstream = { request: vi.fn(demoUpstream.request) }, monitor = new Monitor(upstream, { ...defaultIntervals }, 'UTC')
  const saveIntervals = vi.fn(async () => {})
  const app = createApp({ monitor, password: 'test-password-long-enough', origin: 'https://manager.example', secureCookie: true,
    serverUrl: 'https://upstream.example', instanceName: 'test', instanceId: 'test-id', demo: false, saveIntervals }).compile()
  const request = (path: string, body?: unknown, cookie?: string, origin = 'https://manager.example', method = 'POST') => app.handle(new Request(`https://manager.example/api${path}`, { method: body === undefined ? 'GET' : method, headers: { ...(cookie ? { cookie } : {}), origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }))
  return { request, upstream, saveIntervals }
}
describe('application boundary', () => {
  it('rejects unauthenticated queries before accessing the upstream', async () => {
    const { request, upstream } = setup()
    const config = await request('/config')
    expect(config.status).toBe(200)
    expect((await config.json()).authenticated).toBe(false)
    expect((await request('/accounts')).status).toBe(401)
    expect((await request('/spending/today', { ids: [1], timeZone: 'UTC', includeAdmin: false })).status).toBe(401)
    expect(upstream.request).not.toHaveBeenCalled()
  })
  it('issues a secure session and never exposes the upstream credentials', async () => {
    const { request } = setup()
    const login = await request('/login', { password: 'test-password-long-enough' })
    expect(login.status).toBe(200)
    const setCookie = login.headers.get('set-cookie')!
    expect(setCookie).toMatch(/HttpOnly/i); expect(setCookie).toMatch(/Secure/i); expect(setCookie).toMatch(/SameSite=Strict/i)
    const cookie = setCookie.split(';')[0]
    const accounts = await request('/accounts', undefined, cookie)
    expect(accounts.status).toBe(200)
    expect((await accounts.json()).data).toHaveLength(4)
    await request('/logout', {}, cookie)
    expect((await request('/accounts', undefined, cookie)).status).toBe(401)
  })
  it('blocks cross-origin mutations and validates shared intervals', async () => {
    const { request, saveIntervals } = setup()
    expect((await request('/login', { password: 'test-password-long-enough' }, undefined, 'https://other.example')).status).toBe(403)
    const login = await request('/login', { password: 'test-password-long-enough' })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    expect((await request('/intervals', { status: 0, quota: 1, spending: -1 }, cookie, undefined, 'PUT')).status).toBe(422)
    expect(saveIntervals).not.toHaveBeenCalled()
    expect((await request('/intervals', { status: 10, quota: 60, spending: 30 }, cookie, undefined, 'PUT')).status).toBe(200)
    expect(saveIntervals).toHaveBeenCalledWith({ status: 10, quota: 60, spending: 30 })
  })
  it('validates and serves daily consumption for an authenticated API-key account', async () => {
    const { request } = setup()
    const login = await request('/login', { password: 'test-password-long-enough' })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    expect((await request('/spending/today', { ids: [4], timeZone: 'invalid', includeAdmin: false }, cookie)).status).toBe(422)
    const response = await request('/spending/today', { ids: [4], timeZone: 'UTC', includeAdmin: false }, cookie)
    expect(response.status).toBe(200)
    expect((await response.json()).items[4].data).toBe(12.3)
  })
})

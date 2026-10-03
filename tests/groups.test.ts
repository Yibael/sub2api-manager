import { afterEach, describe, expect, it, vi } from 'vitest'
import { Groups, normalizeGroup } from '../server/groups'
import { formatMultiplier, groupRateRequestSchema, normalizeMultiplier, normalizeWritableMultiplier } from '../shared/groups'
import { createGroupsFixture } from './fixtures/groups'
import { createApp } from '../server/app'
import { Monitor } from '../server/monitor'
import { defaultIntervals } from '../shared/domain'
import type { Upstream } from '../server/upstream'

afterEach(() => vi.useRealTimers())
function fixture() {
  const fixture = createGroupsFixture(), request = vi.fn<Upstream['request']>(fixture.upstream.request)
  return { ...fixture, request, manager: new Groups({ request }) }
}
const writes = (request: ReturnType<typeof fixture>['request']) => request.mock.calls.filter(([, options]) => options?.method === 'PUT')

describe('group rates', () => {
  it('keeps ratio precision and rejects values that JSON numbers would change', () => {
    for (const value of ['0', '-1', 'Infinity', 'NaN', '', '0x10', '1e-400', '0.123456789012345678901']) expect(groupRateRequestSchema.safeParse({ rateMultiplier: value }).success).toBe(false)
    expect(normalizeMultiplier('0.12500')).toBe('0.125')
    expect(formatMultiplier('0.125')).toBe('0.125×')
    expect(formatMultiplier(null)).toBe('—')
    expect(groupRateRequestSchema.parse({ rateMultiplier: ' 1.2500 ' })).toEqual({ rateMultiplier: '1.25' })
    expect(groupRateRequestSchema.safeParse({ rateMultiplier: '1', status: 'inactive' }).success).toBe(false)
  })
  it('rejects upstream storage rounding and overflow before reading or writing', async () => {
    const { manager, request } = fixture()
    for (const value of ['0.00001', '0.12345', '999999.99999', '1000000']) {
      expect(groupRateRequestSchema.safeParse({ rateMultiplier: value }).success).toBe(false)
      await expect(manager.prepare(1, value, 'owner')).rejects.toThrow('最多 4 位小数')
    }
    expect(request).not.toHaveBeenCalled()
    expect(normalizeWritableMultiplier('0.00010')).toBe('0.0001')
    expect(normalizeWritableMultiplier('999999.9999')).toBe('999999.9999')
  })
  it('returns only allowed fields and keeps invalid multipliers unknown', () => {
    const group = normalizeGroup({ id: 1, name: 'test', rate_multiplier: '0.125', account_groups: [{ credentials: 'secret' }], model_routing: 'internal', extra: 'secret' })
    expect(group.rateMultiplier).toBe('0.125')
    expect(JSON.stringify(group)).not.toMatch(/secret|internal|account_groups/)
    expect(group.accountCount).toBeNull()
    expect(normalizeGroup({ id: 1, name: 'test', rate_multiplier: 0 }).rateMultiplier).toBeNull()
    expect(() => normalizeGroup({ id: -1, name: 'bad' })).toThrow('格式不兼容')
  })
  it('shares demand-only directory reads including disabled groups and supports force', async () => {
    const { manager, request } = fixture()
    const samples = await Promise.all([manager.list(), manager.list()])
    expect(samples[0].data).toHaveLength(4)
    expect(samples[0].data?.[3].status).toBe('inactive')
    expect(request).toHaveBeenCalledTimes(1)
    await manager.list()
    expect(request).toHaveBeenCalledTimes(1)
    await manager.list(true)
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('reads all pages and reports broken pagination instead of partial success', async () => {
    const { groups } = createGroupsFixture()
    const request = vi.fn<Upstream['request']>(async (_path, options) => ({ total: 4, items: groups.slice((Number(options?.query?.page) - 1) * 2, Number(options?.query?.page) * 2) }))
    expect((await new Groups({ request }).list()).data).toHaveLength(4)
    expect(request).toHaveBeenCalledTimes(2)
    const broken = new Groups({ request: async () => ({ total: 4, items: [groups[0]] }) })
    expect((await broken.list()).data).toBeNull()
    expect((await broken.list()).error).toContain('分页异常')
  })
  it('prepares without writing, then changes only the confirmed multiplier once', async () => {
    const { manager, request } = fixture()
    await manager.list()
    const preview = await manager.prepare(1, '0.12500', 'owner')
    expect(preview.group.rateMultiplier).toBe('1')
    expect(preview.rateMultiplier).toBe('0.125')
    expect(writes(request)).toHaveLength(0)
    const saved = await manager.confirm(1, preview.token, 'owner')
    expect(saved.rateMultiplier).toBe('0.125')
    expect(writes(request)).toHaveLength(1)
    expect(writes(request)[0]).toEqual(['groups/1', expect.objectContaining({ method: 'PUT', body: { rate_multiplier: 0.125 } })])
    await expect(manager.confirm(1, preview.token, 'owner')).rejects.toMatchObject({ status: 409 })
    expect((await manager.list()).data?.[0].rateMultiplier).toBe('0.125')
  })
  it('binds confirmations to the session, group and proposed value', async () => {
    const { manager, request } = fixture()
    const preview = await manager.prepare(1, '0.5', 'owner')
    await expect(manager.confirm(1, preview.token, 'another')).rejects.toMatchObject({ status: 409 })
    await expect(manager.confirm(2, preview.token, 'owner')).rejects.toMatchObject({ status: 409 })
    expect(writes(request)).toHaveLength(0)
    expect((await manager.confirm(1, preview.token, 'owner')).rateMultiplier).toBe('0.5')
  })
  it('rejects expired, cancelled and superseded confirmations', async () => {
    vi.useFakeTimers()
    const { manager, request } = fixture()
    const first = await manager.prepare(1, '0.5', 'owner')
    const next = await manager.prepare(1, '0.75', 'owner')
    await expect(manager.confirm(1, first.token, 'owner')).rejects.toMatchObject({ status: 409 })
    manager.cancel(1, next.token, 'owner')
    await expect(manager.confirm(1, next.token, 'owner')).rejects.toMatchObject({ status: 409 })
    const expired = await manager.prepare(1, '0.5', 'owner')
    vi.advanceTimersByTime(120_001)
    await expect(manager.confirm(1, expired.token, 'owner')).rejects.toMatchObject({ status: 409 })
    expect(writes(request)).toHaveLength(0)
  })
  it('reads the latest rate for confirmation and detects changes before committing', async () => {
    const { manager, request, groups } = fixture()
    await manager.list()
    groups[0].rate_multiplier = 1.5
    const preview = await manager.prepare(1, '0.5', 'owner')
    expect(preview.group.rateMultiplier).toBe('1.5')
    groups[0].updated_at = '2026-10-03T00:00:01Z'
    await expect(manager.confirm(1, preview.token, 'owner')).rejects.toThrow('已被修改')
    expect(writes(request)).toHaveLength(0)
  })
  it('does not retry a failed write and consumes its confirmation', async () => {
    const { upstream } = createGroupsFixture()
    const request = vi.fn<Upstream['request']>(async (path, options) => {
      if (options?.method === 'PUT') throw new Error('网络中断')
      return upstream.request(path, options)
    })
    const manager = new Groups({ request }), preview = await manager.prepare(1, '0.5', 'owner')
    await expect(manager.confirm(1, preview.token, 'owner')).rejects.toThrow('网络中断')
    await expect(manager.confirm(1, preview.token, 'owner')).rejects.toMatchObject({ status: 409 })
    expect(writes(request)).toHaveLength(1)
  })
  it('serializes same-group writes and discards directory reads begun before a save', async () => {
    const { upstream } = createGroupsFixture()
    let release!: () => void, hold = false
    const request = vi.fn<Upstream['request']>(async (path, options) => {
      const raw = await upstream.request(path, options)
      if (hold && path === 'groups') { hold = false; await new Promise<void>(resolve => { release = resolve }) }
      return raw
    })
    const manager = new Groups({ request })
    const first = await manager.prepare(1, '0.5', 'one'), second = await manager.prepare(1, '0.75', 'two')
    hold = true
    const pending = manager.list()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const saved = manager.confirm(1, first.token, 'one')
    await expect(manager.confirm(1, second.token, 'two')).rejects.toThrow('正在保存')
    await saved
    release()
    expect((await pending).data?.[0].rateMultiplier).toBe('0.5')
    expect(writes(request)).toHaveLength(1)
  })
})

describe('group API boundary', () => {
  function setup(configured = true) {
    const { request, upstream } = fixture()
    const monitor = new Monitor({ request }, { ...defaultIntervals }, 'UTC')
    const origin = 'https://manager.example'
    const app = createApp({ monitor: configured ? monitor : null, password: 'test-password-long-enough', origin, secureCookie: true, serverUrl: 'https://upstream.example', instanceName: 'test', instanceId: 'test', saveIntervals: async () => {} }).compile()
    const call = (path: string, body?: unknown, session?: { cookie: string; token: string }, method = 'POST', from = origin) => app.handle(new Request(`${origin}/api${path}`, { method: body === undefined ? 'GET' : method, headers: { origin: from, 'Content-Type': 'application/json', ...(session ? { cookie: session.cookie, 'x-page-session': session.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }))
    const login = async () => {
      const response = await call('/login', { password: 'test-password-long-enough' })
      return { cookie: response.headers.get('set-cookie')!.split(';')[0], token: (await response.json()).pageToken as string }
    }
    return { call, login, request, upstream }
  }
  it('requires login, a configured monitor and same-origin requests', async () => {
    const { call, login, request } = setup()
    expect((await call('/groups')).status).toBe(401)
    expect((await call('/groups/1/rate/preview', { rateMultiplier: '0.5' })).status).toBe(401)
    expect(request).not.toHaveBeenCalled()
    const session = await login()
    expect((await call('/groups/1/rate/preview', { rateMultiplier: '0.5' }, session, 'POST', 'https://other.example')).status).toBe(403)
    const unconfigured = setup(false)
    expect((await unconfigured.call('/groups', undefined, await unconfigured.login())).status).toBe(503)
  })
  it('accepts only a server-issued confirmation at the write endpoint', async () => {
    const { call, login, request } = setup(), session = await login()
    expect((await call('/groups/1/rate/preview', { rateMultiplier: '0' }, session)).status).toBe(422)
    expect((await call('/groups/0/rate/preview', { rateMultiplier: '0.5' }, session)).status).toBe(422)
    expect((await call('/groups/1/rate', { rateMultiplier: '0.5', confirmed: true }, session, 'PUT')).status).toBe(422)
    expect((await call('/groups/1/rate', { token: 'a'.repeat(64) }, session, 'PUT')).status).toBe(409)
    const preview = await (await call('/groups/1/rate/preview', { rateMultiplier: '0.125' }, session)).json()
    expect(writes(request)).toHaveLength(0)
    expect((await call('/groups/1/rate', { token: preview.token, rateMultiplier: '2' }, session, 'PUT')).status).toBe(422)
    const saved = await call('/groups/1/rate', { token: preview.token }, session, 'PUT')
    expect(saved.status).toBe(200)
    expect((await saved.json()).rateMultiplier).toBe('0.125')
    expect((await call('/groups/1/rate', { token: preview.token }, session, 'PUT')).status).toBe(409)
    expect(writes(request)).toHaveLength(1)
  })
})

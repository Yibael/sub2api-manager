import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Monitor } from '../server/monitor'
import { createApp } from '../server/app'
import { defaultIntervals } from '../shared/domain'
import { UpstreamError, type Upstream } from '../server/upstream'

const now = Date.parse('2026-10-05T06:00:00Z')
const quotaPath = 'openai/accounts/1/quota/refresh', consumePath = 'openai/accounts/1/reset-quota'
function setup(override?: Upstream['request']) {
  let count = 2, enabled = false
  const quota = () => ({ fetched_at: Math.floor(Date.now() / 1000), rate_limit: {
    primary_window: { used_percent: count === 2 ? 99 : 0, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 3600 },
    secondary_window: { used_percent: count === 2 ? 85 : 0, limit_window_seconds: 604800, reset_after_seconds: 86400 },
  }, rate_limit_reset_credits: { available_count: count, credits: Array.from({ length: count }, () => ({ expires_at: new Date(now + 86400000).toISOString() })) },
    credits: { has_credits: true, unlimited: false, balance: '123.456' } })
  const account = () => ({ id: 1, name: 'test', platform: 'openai', type: 'oauth', status: 'active', credentials: { access_token: 'PRIVATE' }, extra: {
    auto_reset_credit_enabled: enabled, codex_reset_credit_snapshot: quota().rate_limit_reset_credits, secret: 'PRIVATE' } })
  const request = vi.fn<Upstream['request']>(async (path, options) => {
    const value = await override?.(path, options)
    if (value !== undefined) return value
    if (path === 'accounts/1') { if (options?.method === 'PUT') enabled = (options.body as { extra: { auto_reset_credit_enabled: boolean } }).extra.auto_reset_credit_enabled; return account() }
    if (path === quotaPath) return { ...quota(), cache_persisted: true, credits_cache_persisted: true }
    if (path === consumePath) { count--; return { code: 'ok', windows_reset: 2, quota: quota(), account: account(), cache_refreshed: true, account_state_recovered: true } }
    throw new Error(`Unexpected path ${path}`)
  })
  const monitor = new Monitor({ request }, { ...defaultIntervals }, 'UTC')
  return { monitor, service: monitor.accountResetCards, request, account, quota, calls: (path: string) => request.mock.calls.filter(([p]) => p === path) }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now) })
afterEach(() => vi.useRealTimers())

describe('manual reset card consumption', () => {
  it('queries quota once for preview, then consumes once and applies the complete response without a second quota query', async () => {
    const { monitor, service, calls } = setup()
    const preview = await service.prepare(1, 'owner')
    expect(calls(quotaPath)).toHaveLength(1)
    expect(calls(consumePath)).toHaveLength(0)
    expect(preview.quota.data?.windows).toMatchObject([{ percent: 99 }, { percent: 85 }])
    expect(JSON.stringify(preview)).not.toMatch(/PRIVATE|credentials|secret|access_token/)
    const result = await service.confirm(1, preview.token, 'owner')
    expect(result.operation.state).toBe('success')
    expect(result.benefits?.resetCredits.data?.availableCount).toBe(1)
    expect(calls(consumePath)).toHaveLength(1)
    expect((await monitor.quota([1]))[1].data?.windows[0].percent).toBe(0)
    expect((await monitor.accountBenefits.readQuota(1)).resetCredits.data?.availableCount).toBe(1)
    expect(calls(quotaPath)).toHaveLength(1)
    await expect(service.confirm(1, preview.token, 'owner')).rejects.toMatchObject({ status: 409 })
    expect(calls(consumePath)).toHaveLength(1)
  })
  it('requires a bound, unexpired confirmation and rejects cancelled, superseded, unsupported or empty accounts', async () => {
    const { service, calls } = setup()
    const first = await service.prepare(1, 'owner')
    await expect(service.confirm(1, first.token, 'other')).rejects.toMatchObject({ status: 409 })
    await expect(service.confirm(2, first.token, 'owner')).rejects.toMatchObject({ status: 409 })
    const next = await service.prepare(1, 'owner')
    await expect(service.confirm(1, first.token, 'owner')).rejects.toMatchObject({ status: 409 })
    service.cancel(1, next.token, 'owner')
    await expect(service.confirm(1, next.token, 'owner')).rejects.toMatchObject({ status: 409 })
    const expired = await service.prepare(1, 'owner')
    vi.advanceTimersByTime(120001)
    await expect(service.confirm(1, expired.token, 'owner')).rejects.toMatchObject({ status: 409 })
    expect(calls(consumePath)).toHaveLength(0)
    const unsupported = setup(async path => path === 'accounts/1' ? { id: 1, platform: 'openai', type: 'oauth', parent_account_id: 2 } : undefined)
    await expect(unsupported.service.prepare(1, 'owner')).rejects.toThrow('母账号')
    expect(unsupported.calls(quotaPath)).toHaveLength(0)
    const empty = setup(async path => path === quotaPath ? { fetched_at: now / 1000, rate_limit_reset_credits: { available_count: 0 } } : undefined)
    await expect(empty.service.prepare(1, 'owner')).rejects.toThrow('没有可用')
  })
  it('retains an uncertain operation, blocks a new consumption and requires a fresh manual check before acknowledgement', async () => {
    const { service, monitor, calls } = setup(async path => { if (path === consumePath) throw new Error('连接中断') })
    const preview = await service.prepare(1, 'owner')
    const result = await service.confirm(1, preview.token, 'owner')
    expect(result.operation.state).toBe('uncertain')
    await expect(service.prepare(1, 'owner')).rejects.toMatchObject({ status: 409 })
    expect(() => service.acknowledge(1, result.operation.id)).toThrow('先手动查询')
    vi.advanceTimersByTime(1000)
    await monitor.accountBenefits.readQuota(1, true)
    expect(service.acknowledge(1, result.operation.id).state).toBe('reviewed')
    expect(calls(consumePath)).toHaveLength(1)
    expect(() => service.acknowledge(1, result.operation.id)).toThrow('已处理')
  })
  it('reports confirmed consumption separately from post-reset failures and never automatically retries', async () => {
    const { service, calls } = setup(async path => path === consumePath ? { code: 'ok', windows_reset: 2, cache_refreshed: false, account_state_recovered: true, warning_code: 'reset_credit_cache_refresh_failed' } : undefined)
    const preview = await service.prepare(1, 'owner')
    const result = await service.confirm(1, preview.token, 'owner')
    expect(result.operation.state).toBe('partial')
    expect(result.operation.message).toContain('已使用 1 张')
    expect(result.quota).toBeNull()
    expect(calls(quotaPath)).toHaveLength(1)
    expect(calls(consumePath)).toHaveLength(1)
  })
  it('shares one account write lock with the auto-reset switch', async () => {
    let finish!: (value: unknown) => void
    const { service, monitor, calls } = setup(async path => path === consumePath ? new Promise(resolve => { finish = resolve }) : undefined)
    const one = await service.prepare(1, 'one'), two = await service.prepare(1, 'two')
    const auto = await monitor.accountAutoReset.prepare(1, true, 'auto')
    const saving = service.confirm(1, one.token, 'one')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await expect(service.confirm(1, two.token, 'two')).rejects.toThrow('正在保存或用卡')
    await expect(monitor.accountAutoReset.confirm(1, auto.token, 'auto')).rejects.toThrow('正在保存或用卡')
    finish({ code: 'ok', windows_reset: 1 })
    await saving
    expect(calls(consumePath)).toHaveLength(1)
  })
  it('obeys force-query failure backoff and 429 before preparing another confirmation', async () => {
    const { service, calls } = setup(async path => { if (path === quotaPath) throw new UpstreamError(429, '限流中', Date.now() + 90000) })
    await expect(service.prepare(1, 'one')).rejects.toThrow('限流中')
    vi.advanceTimersByTime(30000)
    await expect(service.prepare(1, 'one')).rejects.toThrow('限流中')
    expect(calls(quotaPath)).toHaveLength(1)
  })
  it('requires authenticated same-origin API requests and accepts only a confirmation token for consumption', async () => {
    const { monitor, calls } = setup(), origin = 'https://manager.example'
    const app = createApp({ monitor, password: 'password-long-enough', origin, secureCookie: true, serverUrl: 'https://fixture.example', instanceId: 'test', instanceName: 'test', saveIntervals: async () => {} }).compile()
    const send = (path: string, body?: unknown, headers: Record<string, string> = {}) => app.handle(new Request(`${origin}/api${path}`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) }))
    expect((await send('/accounts/1/reset-card/preview')).status).toBe(401)
    const login = await send('/login', { password: 'password-long-enough' })
    const headers = { cookie: login.headers.get('set-cookie')!.split(';')[0], 'x-page-session': (await login.json()).pageToken }
    expect((await send('/accounts/1/reset-card/preview', {}, { ...headers, origin: 'https://other.example' })).status).toBe(403)
    expect((await send('/accounts/1/reset-card/confirm', { count: 1 }, headers)).status).toBe(422)
    expect((await send('/accounts/1/reset-card/confirm', { token: 'a'.repeat(64) }, headers)).status).toBe(409)
    const preview = await (await send('/accounts/1/reset-card/preview', {}, headers)).json()
    expect(calls(consumePath)).toHaveLength(0)
    const result = await send('/accounts/1/reset-card/confirm', { token: preview.token }, headers)
    expect(result.status).toBe(200)
    expect((await result.json()).operation.state).toBe('success')
    expect((await send('/accounts/1/reset-card/confirm', { token: preview.token }, headers)).status).toBe(409)
    expect(calls(consumePath)).toHaveLength(1)
  })
})

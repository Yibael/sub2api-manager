import { Elysia } from 'elysia'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { intervalsSchema, spendingRequestSchema, dailySpendingRequestSchema, type PublicConfig } from '../shared/domain'
import type { Monitor } from './monitor'

export interface AppOptions {
  monitor: Monitor | null; password: string; origin: string; secureCookie: boolean;
  serverUrl: string; instanceName: string; instanceId: string; demo: boolean;
  saveIntervals: (value: z.infer<typeof intervalsSchema>) => Promise<void>
}
export function createApp(options: AppOptions) {
  const sessions = new Map<string, number>()
  const salt = randomBytes(32), passwordHash = scryptSync(options.password, salt, 32)
  let failures = 0, blockedUntil = 0
  const sessionName = 'sub2manager_session'
  const sessionKey = (value: string) => createHash('sha256').update(value).digest('hex')
  const authenticated = (cookieValue: unknown) => options.demo || (typeof cookieValue === 'string' && (sessions.get(sessionKey(cookieValue)) ?? 0) > Date.now())
  const idsSchema = z.object({ ids: z.array(z.number().int().positive()).max(100).transform(ids => [...new Set(ids)]) })
  return new Elysia({ name: 'sub2api-manager', prefix: '/api' })
    .onRequest(({ request, set }) => {
      set.headers['cache-control'] = 'no-store'
      set.headers['x-content-type-options'] = 'nosniff'
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        if (request.headers.get('origin') !== options.origin) return new Response(JSON.stringify({ error: '请求来源无效' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 415 })
      }
    })
    .onError(({ code, set }) => {
      set.status = code === 'VALIDATION' ? 422 : code === 'NOT_FOUND' ? 404 : 500
      return { error: code === 'VALIDATION' ? '请求参数无效，请检查输入' : code === 'NOT_FOUND' ? '接口不存在' : '操作失败，请稍后重试' }
    })
    .get('/config', ({ cookie }): PublicConfig => {
      const auth = authenticated(cookie[sessionName].value)
      return { configured: !!options.monitor, authenticated: auth, demo: options.demo,
        instanceId: options.instanceId, instanceName: options.instanceName,
        serverUrl: auth ? options.serverUrl : '', serverTimeZone: options.monitor?.serverTimeZone ?? 'UTC',
        intervals: options.monitor?.intervals ?? { status: 5, quota: 30, spending: 15 } }
    })
    .post('/login', ({ body, cookie, set }) => {
      if (Date.now() < blockedUntil) { set.status = 429; return { error: '尝试次数过多，请一分钟后重试' } }
      if (!options.password || !timingSafeEqual(scryptSync(body.password, salt, 32), passwordHash)) {
        if (++failures >= 5) { blockedUntil = Date.now() + 60_000; failures = 0 }
        set.status = 401; return { error: '访问密码不正确' }
      }
      failures = 0
      for (const [key, expires] of sessions) if (expires <= Date.now()) sessions.delete(key)
      if (sessions.size >= 256) sessions.delete(sessions.keys().next().value!)
      const token = randomBytes(32).toString('hex')
      sessions.set(sessionKey(token), Date.now() + 7 * 86400000)
      cookie[sessionName].set({ value: token, httpOnly: true, secure: options.secureCookie, sameSite: 'strict', path: '/', maxAge: 7 * 86400 })
      return { ok: true }
    }, { body: z.object({ password: z.string().min(1).max(256) }) })
    .onBeforeHandle(({ cookie, set }) => {
      if (!authenticated(cookie[sessionName].value)) { set.status = 401; return { error: '请先登录' } }
    })
    .post('/logout', ({ cookie }) => {
      const token = cookie[sessionName].value
      if (typeof token === 'string') sessions.delete(sessionKey(token))
      cookie[sessionName].remove()
      return { ok: true }
    })
    .onBeforeHandle(({ set }) => {
      if (!options.monitor) { set.status = 503; return { error: '请先配置服务端 sub2api 连接' } }
    })
    .get('/accounts', () => options.monitor!.accounts())
    .post('/status', ({ body }) => options.monitor!.details(body.ids), { body: idsSchema })
    .post('/today', ({ body }) => options.monitor!.today(body.ids), { body: idsSchema })
    .post('/quota', ({ body }) => options.monitor!.quota(body.ids), { body: idsSchema })
    .post('/spending', ({ body }) => options.monitor!.spending(body), { body: spendingRequestSchema })
    .post('/spending/today', ({ body }) => options.monitor!.dailySpending(body), { body: dailySpendingRequestSchema })
    .put('/intervals', async ({ body }) => {
      await options.saveIntervals(body)
      options.monitor!.intervals = body
      return body
    }, { body: intervalsSchema })
}

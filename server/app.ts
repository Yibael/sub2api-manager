import { Elysia } from 'elysia'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server'
import { intervalsSchema, spendingRequestSchema, dailySpendingRequestSchema, type PublicConfig } from '../shared/domain'
import { workspacePreferencesSchema } from '../shared/preferences'
import type { Monitor } from './monitor'
import { WorkspaceStore, WorkspaceConflict } from './workspace'
import { Passkeys, PasskeyError } from './passkeys'

export interface AppOptions {
  monitor: Monitor | null; password: string; origin: string; secureCookie: boolean;
  serverUrl: string; instanceName: string; instanceId: string; workspace?: WorkspaceStore;
  saveIntervals: (value: z.infer<typeof intervalsSchema>) => Promise<void>
}
export function createApp(options: AppOptions) {
  const store = options.workspace ?? WorkspaceStore.memory(options.instanceId, options.monitor?.serverTimeZone)
  const passkeys = new Passkeys(store, options.origin, options.instanceName)
  const sessions = new Map<string, { expires: number; pageTokenHash: string; credentialId?: string }>()
  const salt = randomBytes(32), passwordHash = scryptSync(options.password, salt, 32)
  let failures = 0, blockedUntil = 0
  const sessionName = 'sub2manager_session', challengeName = 'sub2manager_challenge'
  const sessionKey = (value: string) => createHash('sha256').update(value).digest('hex')
  const session = (value: unknown) => typeof value === 'string' ? sessions.get(sessionKey(value)) : undefined
  const authenticated = (value: unknown, pageToken: string | null | undefined) => {
    const current = session(value)
    return !!current && current.expires > Date.now() && !!pageToken && /^[a-f0-9]{64}$/.test(pageToken) && current.pageTokenHash === sessionKey(pageToken)
  }
  const pageToken = (request: Request) => request.headers.get('x-page-session')
  const passwordMatches = (password: string) => !!options.password && timingSafeEqual(scryptSync(password, salt, 32), passwordHash)
  const failed = () => { if (++failures >= 5) { blockedUntil = Date.now() + 60_000; failures = 0 } }
  const issue = (credentialId?: string) => {
    failures = 0
    for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key)
    if (sessions.size >= 256) sessions.delete(sessions.keys().next().value!)
    const token = randomBytes(32).toString('hex'), pageToken = randomBytes(32).toString('hex')
    sessions.set(sessionKey(token), { expires: Date.now() + 7 * 86400000, pageTokenHash: sessionKey(pageToken), credentialId })
    return { cookie: { value: token, httpOnly: true, secure: options.secureCookie, sameSite: 'strict' as const, path: '/', maxAge: 7 * 86400 }, pageToken }
  }
  const challengeCookie = (value: string) => ({ value, httpOnly: true, secure: options.secureCookie, sameSite: 'strict' as const, path: '/api/passkeys', maxAge: 120 })
  const requireMonitor = () => options.monitor ? undefined : new Response(JSON.stringify({ error: '请先配置服务端 sub2api 连接' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  const idsSchema = z.object({ ids: z.array(z.number().int().positive()).max(100).transform(ids => [...new Set(ids)]), force: z.boolean().optional() })
  const passwordSchema = z.object({ password: z.string().min(1).max(256) })
  const credentialResponse = z.object({ id: z.string().min(1).max(2048), rawId: z.string().min(1).max(2048), type: z.literal('public-key'), response: z.record(z.string(), z.unknown()), clientExtensionResults: z.record(z.string(), z.unknown()) }).passthrough().refine(value => JSON.stringify(value).length <= 160_000)
  return new Elysia({ name: 'sub2api-manager', prefix: '/api' })
    .onRequest(({ request, set }) => {
      set.headers['cache-control'] = 'no-store'
      set.headers['x-content-type-options'] = 'nosniff'
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        if (request.headers.get('origin') !== options.origin) return new Response(JSON.stringify({ error: '请求来源无效' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 415 })
      }
    })
    .onError(({ code, error, set }) => {
      set.status = error instanceof WorkspaceConflict ? 409 : error instanceof PasskeyError ? error.status : code === 'VALIDATION' ? 422 : code === 'NOT_FOUND' ? 404 : 500
      return { error: error instanceof WorkspaceConflict || error instanceof PasskeyError ? error.message : code === 'VALIDATION' ? '请求参数无效，请检查输入' : code === 'NOT_FOUND' ? '接口不存在' : '操作失败，请稍后重试' }
    })
    .get('/config', ({ cookie, request }): PublicConfig => {
      const auth = authenticated(cookie[sessionName].value, pageToken(request))
      return { configured: !!options.monitor, authenticated: auth, instanceId: store.id, instanceName: options.instanceName,
        serverUrl: auth ? options.serverUrl : '', serverTimeZone: options.monitor?.serverTimeZone ?? 'UTC',
        intervals: options.monitor?.intervals ?? store.snapshot().preferences.intervals, passkeyAvailable: passkeys.available(),
        ...(auth ? { legacyInstanceIds: store.legacyInstanceIds } : {}) }
    })
    .post('/login', ({ body, cookie, set }) => {
      if (Date.now() < blockedUntil) { set.status = 429; return { error: '尝试次数过多，请一分钟后重试' } }
      if (!passwordMatches(body.password)) { failed(); set.status = 401; return { error: '访问密码不正确' } }
      if (typeof cookie[sessionName].value === 'string') sessions.delete(sessionKey(cookie[sessionName].value))
      const next = issue(); cookie[sessionName].set(next.cookie)
      return { pageToken: next.pageToken }
    }, { body: passwordSchema })
    .post('/passkeys/login/options', async ({ cookie }) => {
      if (Date.now() < blockedUntil) throw new PasskeyError('尝试次数过多，请一分钟后重试', 429)
      const { options: value, challengeId } = await passkeys.authenticationOptions()
      cookie[challengeName].set(challengeCookie(challengeId))
      return value
    }, { body: z.object({}) })
    .post('/passkeys/login/verify', async ({ body, cookie }) => {
      const challenge = cookie[challengeName].value
      cookie[challengeName].set({ ...challengeCookie(''), maxAge: 0 })
      if (Date.now() < blockedUntil) throw new PasskeyError('尝试次数过多，请一分钟后重试', 429)
      let credentialId: string
      try { credentialId = await passkeys.authenticate(challenge, body as unknown as AuthenticationResponseJSON) }
      catch (error) { if (error instanceof PasskeyError) failed(); throw error }
      if (typeof cookie[sessionName].value === 'string') sessions.delete(sessionKey(cookie[sessionName].value))
      const next = issue(credentialId); cookie[sessionName].set(next.cookie)
      return { pageToken: next.pageToken }
    }, { body: credentialResponse })
    .post('/lock', ({ body, cookie }) => {
      if (authenticated(cookie[sessionName].value, body.pageToken)) sessions.delete(sessionKey(cookie[sessionName].value as string))
      return { ok: true }
    }, { body: z.object({ pageToken: z.string().regex(/^[a-f0-9]{64}$/) }) })
    .onBeforeHandle(({ cookie, request, set }) => {
      if (!authenticated(cookie[sessionName].value, pageToken(request))) { set.status = 401; return { error: '请先登录' } }
    })
    .post('/logout', ({ cookie }) => {
      const token = cookie[sessionName].value
      if (typeof token === 'string') sessions.delete(sessionKey(token))
      cookie[sessionName].remove()
      return { ok: true }
    })
    .get('/workspace', () => store.snapshot())
    .patch('/workspace', async ({ body }) => {
      const value = await store.update(body.revision, body.preferences)
      if (options.monitor) options.monitor.intervals = value.preferences.intervals
      return value
    }, { body: z.object({ revision: z.number().int().nonnegative(), preferences: workspacePreferencesSchema.partial().strict() }) })
    .get('/passkeys', () => ({ items: store.summaries() }))
    .post('/passkeys/register/options', async ({ body, cookie }) => {
      const { options: value, challengeId } = await passkeys.registrationOptions(sessionKey(cookie[sessionName].value as string), body.name)
      cookie[challengeName].set(challengeCookie(challengeId))
      return value
    }, { body: z.object({ name: z.string().trim().min(1).max(80) }) })
    .post('/passkeys/register/verify', async ({ body, cookie }) => {
      const challenge = cookie[challengeName].value
      cookie[challengeName].set({ ...challengeCookie(''), maxAge: 0 })
      await passkeys.register(challenge, sessionKey(cookie[sessionName].value as string), body as unknown as RegistrationResponseJSON)
      return { ok: true }
    }, { body: credentialResponse })
    .post('/passkeys/rename', async ({ body }) => {
      await store.renamePasskey(body.id, body.name)
      return { ok: true }
    }, { body: z.object({ id: z.string().min(1).max(2048), name: z.string().trim().min(1).max(80) }) })
    .post('/passkeys/remove', async ({ body, cookie }) => {
      await store.removePasskey(body.id)
      for (const [key, value] of sessions) if (value.credentialId === body.id) sessions.delete(key)
      if (!session(cookie[sessionName].value)) cookie[sessionName].remove()
      return { ok: true }
    }, { body: z.object({ id: z.string().min(1).max(2048) }) })
    .get('/accounts', ({ query }) => options.monitor!.accounts(query.force === 'true'), { beforeHandle: requireMonitor })
    .post('/status', ({ body }) => options.monitor!.details(body.ids, undefined, body.force), { body: idsSchema, beforeHandle: requireMonitor })
    .post('/today', ({ body }) => options.monitor!.today(body.ids, body.force), { body: idsSchema, beforeHandle: requireMonitor })
    .post('/quota', ({ body }) => options.monitor!.quota(body.ids, body.force), { body: idsSchema, beforeHandle: requireMonitor })
    .post('/spending', ({ body }) => options.monitor!.spending(body), { body: spendingRequestSchema, beforeHandle: requireMonitor })
    .post('/spending/today', ({ body }) => options.monitor!.dailySpending(body), { body: dailySpendingRequestSchema, beforeHandle: requireMonitor })
    .put('/intervals', async ({ body }) => {
      await options.saveIntervals(body)
      const value = await store.update(store.snapshot().revision, { intervals: body })
      options.monitor!.intervals = value.preferences.intervals
      return body
    }, { body: intervalsSchema, beforeHandle: requireMonitor })
}

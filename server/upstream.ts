import { object } from './normalize'

export class UpstreamError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryAt?: number) { super(message) }
}
export interface Upstream { request(path: string, options?: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal }): Promise<unknown> }

export function createUpstream(baseUrl: string, key: string, allowHTTP = false): Upstream {
  const url = new URL(baseUrl)
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('SUB2API_URL 格式无效')
  if (url.protocol !== 'https:' && !allowHTTP) throw new Error('使用 HTTP 上游需要显式设置 ALLOW_HTTP_UPSTREAM=true')
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1(?:\/admin)?$/, '') + '/api/v1/admin/'
  let active = 0
  let blockedUntil = 0
  const queue: (() => void)[] = []
  const checkCooldown = () => {
    if (Date.now() < blockedUntil) throw new UpstreamError(429, '上游请求过于频繁，请稍后重试', blockedUntil)
  }
  return {
    async request(path, options = {}) {
      checkCooldown()
      const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(options.signal ? [options.signal] : [])])
      if (active < 4) active++
      else await new Promise<void>((resolve, reject) => {
        const enter = () => { signal.removeEventListener('abort', abort); resolve() }
        const abort = () => { const i = queue.indexOf(enter); if (i >= 0) queue.splice(i, 1); reject(new Error('查询超时，请稍后重试')) }
        queue.push(enter)
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
      })
      try {
        // A queued caller may have expired or another request may have received 429.
        // Neither case should start another network request after gaining a slot.
        signal.throwIfAborted()
        checkCooldown()
        const target = new URL(path, url)
        for (const [name, value] of Object.entries(options.query ?? {})) target.searchParams.set(name, value)
        const response = await fetch(target, {
          method: options.body === undefined ? 'GET' : 'POST', redirect: 'manual', signal,
          headers: { 'x-api-key': key, Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        })
        if (response.status === 429) {
          const header = response.headers.get('retry-after')
          const seconds = header !== null && /^\d+$/.test(header.trim()) ? Number(header) : NaN
          const deadline = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : header ? Date.parse(header) : NaN
          blockedUntil = Math.max(blockedUntil, Number.isFinite(deadline) && deadline > Date.now() ? deadline : Date.now() + 30_000)
        }
        if (!response.ok) throw new UpstreamError(response.status,
          [401, 403].includes(response.status) ? 'sub2api 认证失败，请检查服务端 Admin Key' : response.status === 429 ? '上游请求过于频繁，请稍后重试' : `sub2api 请求失败（${response.status}）`,
          response.status === 429 ? blockedUntil : undefined)
        const envelope = object(await response.json())
        if (envelope.code !== 0 || envelope.data === undefined || envelope.data === null) throw new Error('sub2api 响应格式不兼容')
        return envelope.data
      } catch (error) {
        if (error instanceof UpstreamError) throw error
        if (signal.aborted) throw new Error('查询超时，请稍后重试')
        throw new Error('无法读取 sub2api 数据，请检查连接与接口版本')
      } finally {
        const next = queue.shift()
        if (next) next()
        else active--
      }
    },
  }
}

import { randomBytes } from 'node:crypto'
import type { Sample } from '../shared/domain'
import { multiplierInputError, normalizeMultiplier, normalizeWritableMultiplier, type Group, type GroupRatePreview } from '../shared/groups'
import { DemandCache } from './cache'
import { object } from './normalize'
import type { Upstream } from './upstream'

export class GroupError extends Error {
  constructor(message: string, public readonly status = 400) { super(message) }
}

export function normalizeGroup(value: unknown): Group {
  const raw = object(value)
  if (!Number.isSafeInteger(raw.id) || (raw.id as number) <= 0 || typeof raw.name !== 'string') throw new GroupError('分组响应格式不兼容', 502)
  return {
    id: raw.id as number, name: raw.name.slice(0, 200),
    description: typeof raw.description === 'string' ? raw.description.slice(0, 1000) : '',
    platform: typeof raw.platform === 'string' ? raw.platform : 'unknown',
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    rateMultiplier: normalizeMultiplier(raw.rate_multiplier),
    subscriptionType: typeof raw.subscription_type === 'string' ? raw.subscription_type : 'unknown',
    exclusive: raw.is_exclusive === true,
    accountCount: Number.isSafeInteger(raw.account_count) && (raw.account_count as number) >= 0 ? raw.account_count as number : null,
    imageRateIndependent: raw.image_rate_independent === true,
    updatedAt: typeof raw.updated_at === 'string' && Number.isFinite(Date.parse(raw.updated_at)) ? raw.updated_at : null,
  }
}

interface Confirmation extends GroupRatePreview { session: string }

export class Groups {
  private cache = new DemandCache<Group[]>()
  private confirmations = new Map<string, Confirmation>()
  private busy = new Set<number>()
  constructor(private readonly upstream: Upstream) {}

  async list(force = false): Promise<Sample<Group[]>> {
    const cache = this.cache
    const result = await cache.get('groups', 60_000, async () => {
      const signal = AbortSignal.timeout(30_000), groups: Group[] = [], seen = new Set<number>()
      for (let page = 1; page <= 100; page++) {
        const raw = object(await this.upstream.request('groups', { query: { page: String(page), page_size: '100' }, signal }))
        if (!Array.isArray(raw.items) || !Number.isSafeInteger(raw.total) || (raw.total as number) < 0) throw new GroupError('分组目录响应格式不兼容', 502)
        const previous = seen.size
        for (const item of raw.items) {
          const group = normalizeGroup(item)
          if (!seen.has(group.id)) { seen.add(group.id); groups.push(group) }
        }
        if (groups.length >= (raw.total as number)) return groups
        if (previous === seen.size) throw new GroupError('分组目录分页异常', 502)
      }
      throw new GroupError('分组目录超过可读取范围', 502)
    }, force)
    // A directory read started before a write must not restore stale results.
    return cache === this.cache ? result : this.list()
  }

  private async read(id: number, signal: AbortSignal) {
    const group = normalizeGroup(await this.upstream.request(`groups/${id}`, { signal }))
    if (group.id !== id) throw new GroupError('分组响应不匹配', 502)
    if (group.rateMultiplier === null) throw new GroupError('当前倍率无效，请在 sub2api 中检查', 409)
    return group
  }

  async prepare(id: number, rateMultiplier: string, session: string): Promise<GroupRatePreview> {
    const rate = normalizeWritableMultiplier(rateMultiplier)
    if (rate === null) throw new GroupError(multiplierInputError)
    const group = await this.read(id, AbortSignal.timeout(30_000))
    if (group.rateMultiplier === rate) throw new GroupError('倍率未发生变化')
    for (const [token, entry] of this.confirmations) if (entry.expiresAt <= Date.now() || entry.session === session && entry.group.id === id) this.confirmations.delete(token)
    if (this.confirmations.size >= 256) throw new GroupError('待确认操作过多，请稍后重试', 429)
    const preview = { token: randomBytes(32).toString('hex'), group, rateMultiplier: rate, expiresAt: Date.now() + 120_000 }
    this.confirmations.set(preview.token, { ...preview, session })
    return preview
  }

  cancel(id: number, token: string, session: string) {
    const entry = this.confirmations.get(token)
    if (entry?.session === session && entry.group.id === id) this.confirmations.delete(token)
  }

  async confirm(id: number, token: string, session: string): Promise<Group> {
    const entry = this.confirmations.get(token)
    if (!entry || entry.session !== session || entry.group.id !== id) throw new GroupError('确认已失效，请重新检查变更', 409)
    this.confirmations.delete(token)
    if (entry.expiresAt <= Date.now()) throw new GroupError('确认已过期，请重新检查变更', 409)
    if (this.busy.has(id)) throw new GroupError('此分组正在保存，请稍后重新检查', 409)
    this.busy.add(id)
    const signal = AbortSignal.timeout(30_000)
    try {
      const current = await this.read(id, signal)
      if (current.rateMultiplier !== entry.group.rateMultiplier || current.updatedAt !== entry.group.updatedAt || current.name !== entry.group.name || current.platform !== entry.group.platform || current.status !== entry.group.status || current.imageRateIndependent !== entry.group.imageRateIndependent || current.subscriptionType !== entry.group.subscriptionType || current.exclusive !== entry.group.exclusive) {
        throw new GroupError('分组已被修改，请重新检查当前倍率后确认', 409)
      }
      // Only the confirmed field leaves this service; no other group settings
      // can be written through the manager. Never retry an upstream mutation.
      let raw: unknown
      try {
        raw = await this.upstream.request(`groups/${id}`, { method: 'PUT', body: { rate_multiplier: Number(entry.rateMultiplier) }, signal })
      } finally {
        // Also invalidate after uncertain results (for example a network timeout).
        this.cache = new DemandCache<Group[]>()
      }
      const saved = normalizeGroup(raw)
      if (saved.id !== id || saved.rateMultiplier !== entry.rateMultiplier) throw new GroupError('保存结果未能确认，请刷新分组核对后再操作', 502)
      return saved
    } finally { this.busy.delete(id) }
  }
}

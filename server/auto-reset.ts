import { randomBytes } from 'node:crypto'
import type { Account } from '../shared/domain'
import type { AutoResetPreview } from '../shared/auto-reset'
import { normalizeAccount, object, resetThreshold, type Raw } from './normalize'
import type { Upstream } from './upstream'

export class AutoResetError extends Error {
  constructor(message: string, public readonly status = 400) { super(message) }
}
interface Confirmation extends AutoResetPreview { session: string }

export class AutoReset {
  private confirmations = new Map<string, Confirmation>()
  private busy = new Set<number>()
  constructor(private readonly upstream: Upstream, private readonly invalidate: () => void) {}

  private async read(id: number, signal: AbortSignal) {
    const raw = object(await this.upstream.request(`accounts/${id}`, { signal })), account = normalizeAccount(raw)
    if (account.id !== id) throw new AutoResetError('账号响应不匹配', 502)
    if (!account.autoReset) throw new AutoResetError('仅 OpenAI OAuth 母账号支持自动使用重置卡')
    const extra = object(raw.extra)
    for (const key of ['auto_reset_credit_5h_threshold', 'auto_reset_credit_7d_threshold']) {
      if (key in extra && resetThreshold(extra[key]) === null) throw new AutoResetError('账号自动用卡阈值无效，请先在 Sub2API 中修正', 409)
    }
    return { raw, account, config: account.autoReset }
  }

  async prepare(id: number, enabled: boolean, session: string): Promise<AutoResetPreview> {
    const { account, config } = await this.read(id, AbortSignal.timeout(30_000))
    if (config.enabled === enabled) throw new AutoResetError('自动使用重置卡开关未发生变化')
    for (const [token, entry] of this.confirmations) if (entry.expiresAt <= Date.now() || entry.session === session && entry.account.id === id) this.confirmations.delete(token)
    if (this.confirmations.size >= 256) throw new AutoResetError('待确认操作过多，请稍后重试', 429)
    const preview = { token: randomBytes(32).toString('hex'), account: { id, name: account.name }, current: config, enabled, expiresAt: Date.now() + 120_000 }
    this.confirmations.set(preview.token, { ...preview, session })
    return preview
  }

  cancel(id: number, token: string, session: string) {
    const entry = this.confirmations.get(token)
    if (entry?.session === session && entry.account.id === id) this.confirmations.delete(token)
  }

  async confirm(id: number, token: string, session: string): Promise<Account> {
    const entry = this.confirmations.get(token)
    if (!entry || entry.session !== session || entry.account.id !== id) throw new AutoResetError('确认已失效，请重新检查变更', 409)
    this.confirmations.delete(token)
    if (entry.expiresAt <= Date.now()) throw new AutoResetError('确认已过期，请重新检查变更', 409)
    if (this.busy.has(id)) throw new AutoResetError('此账号正在保存，请稍后重新检查', 409)
    this.busy.add(id)
    const signal = AbortSignal.timeout(30_000)
    try {
      const { raw, account, config } = await this.read(id, signal)
      if (account.name !== entry.account.name || config.enabled !== entry.current.enabled || config.threshold5h !== entry.current.threshold5h || config.threshold7d !== entry.current.threshold7d) {
        throw new AutoResetError('自动用卡配置已被修改，请重新检查后确认', 409)
      }
      // PUT replaces extra upstream. Merge the latest server-side extra, and
      // leave runtime state to Sub2API's managed-field preservation logic.
      const extra: Raw = { ...object(raw.extra), auto_reset_credit_enabled: entry.enabled }
      delete extra.codex_auto_reset_credit_state
      let response: unknown
      try { response = await this.upstream.request(`accounts/${id}`, { method: 'PUT', body: { extra }, signal }) }
      finally { this.invalidate() }
      const saved = normalizeAccount(response)
      if (saved.id !== id || !saved.autoReset || saved.autoReset.enabled !== entry.enabled || saved.autoReset.threshold5h !== config.threshold5h || saved.autoReset.threshold7d !== config.threshold7d) {
        throw new AutoResetError('保存结果未能确认，请刷新账号核对后再操作', 502)
      }
      return saved
    } finally { this.busy.delete(id) }
  }
}

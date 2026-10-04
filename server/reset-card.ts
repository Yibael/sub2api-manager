import { randomBytes } from 'node:crypto'
import type { ResetCardOperation, ResetCardPreview, ResetCardResult } from '../shared/reset-card'
import { availableResetCredits } from '../shared/benefits'
import { normalizeAccount, object } from './normalize'
import { AccountWriteLock } from './account-lock'
import type { Benefits } from './benefits'
import type { ManagerPersistence } from './persistence'
import { UpstreamError, type Upstream } from './upstream'

export class ResetCardError extends Error {
  constructor(message: string, public readonly status = 400) { super(message) }
}
interface Confirmation extends ResetCardPreview { session: string }
export class ResetCards {
  private confirmations = new Map<string, Confirmation>()
  constructor(private upstream: Upstream, private benefits: Benefits, private persistence: ManagerPersistence,
    private lock: AccountWriteLock, private apply: (id: number, result: ResetCardResult) => void) {}

  latest(id: number) { return this.persistence.latestOperation(id) }
  private checkUnresolved(id: number) {
    if (['executing', 'uncertain'].includes(this.latest(id)?.state ?? '')) throw new ResetCardError('此账号有结果待确认的用卡操作，请先查询额度并核对。', 409)
  }
  private async read(id: number) {
    const account = normalizeAccount(await this.upstream.request(`accounts/${id}`, { signal: AbortSignal.timeout(30_000) }))
    if (account.id !== id) throw new ResetCardError('账号响应不匹配', 502)
    if (!account.autoReset) throw new ResetCardError('仅 OpenAI OAuth 母账号支持手动使用重置卡')
    return account
  }
  async prepare(id: number, session: string): Promise<ResetCardPreview> {
    this.checkUnresolved(id)
    const account = await this.read(id)
    // One quota refresh also supplies card inventory and Credits. No separate usage call.
    const sample = await this.benefits.refreshQuota(id), data = sample.data
    if (sample.error || !data) throw new ResetCardError(sample.error ?? '额度查询未完成，请重试', 502)
    const count = availableResetCredits(data.resetCredits, Date.now())
    if (count === null) throw new ResetCardError('可用重置卡数量未知，请查询后再试', 409)
    if (count === 0) throw new ResetCardError('当前没有可用重置卡', 409)
    if (!data.usage.windows.length || data.usage.windows.some(v => v.percent === null || !v.resetsAt)) throw new ResetCardError('额度信息不完整，请查询后再试', 502)
    this.checkUnresolved(id)
    for (const [token, entry] of this.confirmations) if (entry.expiresAt <= Date.now() || entry.session === session && entry.account.id === id) this.confirmations.delete(token)
    if (this.confirmations.size >= 256) throw new ResetCardError('待确认操作过多，请稍后重试', 429)
    const preview: ResetCardPreview = { token: randomBytes(32).toString('hex'), operationId: randomBytes(16).toString('hex'),
      expiresAt: Date.now() + 120_000, account: { id, name: account.name }, availableCount: count, autoReset: account.autoReset!,
      quota: { data: data.usage, updatedAt: data.resetCredits.updatedAt, error: null }, benefits: { resetCredits: data.resetCredits, credits: data.credits } }
    this.confirmations.set(preview.token, { ...preview, session })
    return preview
  }
  cancel(id: number, token: string, session: string) {
    const entry = this.confirmations.get(token)
    if (entry?.session === session && entry.account.id === id) this.confirmations.delete(token)
  }
  async confirm(id: number, token: string, session: string): Promise<ResetCardResult> {
    const entry = this.confirmations.get(token)
    if (!entry || entry.session !== session || entry.account.id !== id) throw new ResetCardError('确认已失效或已处理，请重新核对', 409)
    this.confirmations.delete(token)
    if (entry.expiresAt <= Date.now()) throw new ResetCardError('确认已过期，请重新查询后确认', 409)
    return this.lock.run(id, async () => {
      this.checkUnresolved(id)
      const account = await this.read(id)
      if (account.name !== entry.account.name || JSON.stringify(account.autoReset) !== JSON.stringify(entry.autoReset)) throw new ResetCardError('账号或自动用卡配置已变化，请重新查询后确认', 409)
      const available = availableResetCredits(entry.benefits.resetCredits, Date.now())
      const cached = account.benefits && availableResetCredits(account.benefits.resetCredits, Date.now())
      if (!available || cached === 0) throw new ResetCardError('重置卡已不可用，请重新查询后确认', 409)
      let operation: ResetCardOperation = { id: entry.operationId, accountId: id, state: 'executing', startedAt: Date.now(), finishedAt: null,
        windowsReset: null, message: '正在使用 1 张重置卡。' }
      // Persist the intent before dispatch. A crash or lost response cannot cause a resend.
      if (!this.persistence.claimOperation(operation)) throw new ResetCardError('此操作已执行或此账号有待确认操作，请先核对', 409)
      let raw: Record<string, unknown>
      try { raw = object(await this.upstream.request(`openai/accounts/${id}/reset-quota`, { method: 'POST', signal: AbortSignal.timeout(30_000) })) }
      catch (error) {
        const rejected = error instanceof UpstreamError && [400, 401, 403, 404, 405, 429].includes(error.status)
        operation = { ...operation, finishedAt: Date.now(), state: rejected ? 'rejected' : 'uncertain',
          message: rejected ? `用卡请求被拒绝：${(error as Error).message}` : '用卡结果未能确认，可能已消耗重置卡。请手动查询额度并核对，系统不会自动重发。' }
        this.persistence.updateOperation(operation)
        const result: ResetCardResult = { operation, account: null, quota: null, benefits: null }
        if (!rejected) { this.benefits.invalidateQuota(id); this.apply(id, result) }
        return result
      }
      // Sub2API's successful response confirms consumption independently of post-processing.
      let saved = null, quota = null, benefits = null
      try {
        if (raw.account) { saved = normalizeAccount(raw.account); if (saved.id !== id || !saved.autoReset) saved = null }
        if (raw.quota && raw.cache_refreshed === true) {
          const updated = this.benefits.applyQuota(id, { ...object(raw.quota), cache_persisted: true, credits_cache_persisted: true })
          quota = updated.quota; benefits = updated.benefits
          if (!quota.data.windows.length) quota = null
        }
      } catch { /* The card may be spent even if follow-up data is incompatible. */ }
      const windowsReset = typeof raw.windows_reset === 'number' && Number.isSafeInteger(raw.windows_reset) && raw.windows_reset >= 0 ? raw.windows_reset : null
      const validResult = raw.code === 'ok' && windowsReset !== null
      const complete = validResult && !!saved && !!quota && !!benefits && raw.cache_refreshed === true && raw.account_state_recovered === true && !raw.warning_code
      operation = { ...operation, windowsReset, finishedAt: Date.now(), state: !validResult ? 'uncertain' : complete ? 'success' : 'partial',
        message: !validResult ? '用卡响应不兼容，结果待确认。请手动查询额度并核对。'
          : complete ? '已使用 1 张重置卡，额度与权益已更新。' : '已使用 1 张重置卡，账号或额度数据尚未完整更新，请手动查询并核对。' }
      this.persistence.updateOperation(operation)
      if (!benefits) this.benefits.invalidateQuota(id)
      const result: ResetCardResult = { operation, account: saved, quota, benefits }
      this.apply(id, result)
      return result
    }, () => new ResetCardError('此账号正在保存或用卡，请稍后重新检查', 409))
  }
  acknowledge(id: number, operationId: string) {
    const operation = this.persistence.operation(operationId)
    if (!operation || operation.accountId !== id || operation.state !== 'uncertain') throw new ResetCardError('此操作不需要核对或已处理', 409)
    const checked = this.persistence.benefit(id, 'resetCredits')
    if (!checked?.sample.data || checked.source !== 'query' || checked.observedAt < (operation.finishedAt ?? operation.startedAt) || checked.sample.updatedAt === null) throw new ResetCardError('请先手动查询最新额度和重置卡，再确认核对结果', 409)
    const reviewed: ResetCardOperation = { ...operation, state: 'reviewed', message: '已由用户核对；原用卡结果仍无法自动确认。' }
    this.persistence.updateOperation(reviewed)
    return reviewed
  }
}

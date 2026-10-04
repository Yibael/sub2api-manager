import type { Account, Sample } from '../shared/domain'
import type { AccountBenefits, BenefitChannel, BenefitSample, QuotaBenefits, ReferralBenefits } from '../shared/benefits'
import { DemandCache } from './cache'
import { benefitSample, fetchedAt, normalizeCredits, normalizeReferrals, normalizeResetCredits, object } from './normalize'
import { UpstreamError, type Upstream } from './upstream'

export class BenefitsError extends Error {
  constructor(message: string, public readonly status = 400) { super(message) }
}
interface QuotaResult { resetCredits: AccountBenefits['resetCredits']; credits: AccountBenefits['credits']; resetTimeValid: boolean }
interface ReferralResult { referrals: AccountBenefits['referrals'] }
type AccountSample = Sample<Account> & { readStartedAt: number | null }
const cacheWarning = (value: unknown) => value === true ? null : value === false
  ? '查询成功，但未保存到 Sub2API；下次读取可能仍是旧值'
  : '查询成功，但未能确认是否已保存到 Sub2API'

/** Automatic reads only use account snapshots; only an explicit refresh queries upstream. */
export class Benefits {
  private quota = new DemandCache<QuotaResult>()
  private referrals = new DemandCache<ReferralResult>()
  constructor(private upstream: Upstream, private account: (id: number) => Promise<AccountSample>) {}

  read(id: number): Promise<AccountBenefits> { return this.load(id) }

  async readQuota(id: number, force = false): Promise<QuotaBenefits> {
    const { resetCredits, credits } = await this.load(id, force ? 'quota' : undefined)
    return { resetCredits, credits }
  }

  async readReferrals(id: number, force = false): Promise<ReferralBenefits> {
    const { referrals } = await this.load(id, force ? 'referrals' : undefined)
    return { referrals }
  }

  private async load(id: number, refresh?: BenefitChannel): Promise<AccountBenefits> {
    const account = await this.account(id)
    if (!account.data) throw new BenefitsError('账号权益暂不可用，请刷新账号详情', 502)
    if (!account.data.benefits) throw new BenefitsError('此账号不支持查询 OpenAI 权益')
    const key = String(id)
    if (refresh && !account.error) {
      const signal = AbortSignal.timeout(30_000)
      if (refresh === 'quota') {
        await this.quota.get(key, 30_000, async () => {
          const raw = object(await this.refresh(`openai/accounts/${id}/quota/refresh`, signal))
          const updatedAt = fetchedAt(raw.fetched_at)
          if (updatedAt === null) throw new Error('重置卡和 Credits 查询响应不兼容')
          return {
            resetCredits: { ...benefitSample(normalizeResetCredits(raw.rate_limit_reset_credits), updatedAt), warning: cacheWarning(raw.cache_persisted) },
            credits: { ...benefitSample(normalizeCredits(raw.credits), updatedAt), warning: cacheWarning(raw.credits_cache_persisted) },
            resetTimeValid: true,
          }
        }, true)
      } else {
        await this.referrals.get(key, 30_000, async () => {
          const raw = object(await this.refresh(`openai/accounts/${id}/referrals/refresh`, signal))
          const eligibility = object(raw.eligibility), updatedAt = fetchedAt(eligibility.fetched_at)
          if (updatedAt === null) throw new Error('可邀请数量查询响应不兼容')
          return { referrals: { ...benefitSample(normalizeReferrals(eligibility), updatedAt), warning: cacheWarning(raw.cache_persisted) } }
        }, true)
      }
    }
    const quota = this.quota.peek(key), referrals = this.referrals.peek(key), snapshots = account.data.benefits
    const resetCredits = this.select(snapshots.resetCredits, quota?.data?.resetCredits, quota, account)
    if (quota?.data && this.useSnapshot(quota.data.resetCredits, quota, account)) {
      // Sub2API omits reset snapshot query time. Keep the time of our known
      // query while the snapshot is unchanged; a changed value invalidates it.
      // Remember invalidation so returning to an old value cannot revive its time.
      if (JSON.stringify(snapshots.resetCredits.data) !== JSON.stringify(quota.data.resetCredits.data)) quota.data.resetTimeValid = false
      if (quota.data.resetTimeValid && resetCredits.updatedAt === null) resetCredits.updatedAt = quota.data.resetCredits.updatedAt
    }
    return {
      resetCredits,
      credits: this.select(snapshots.credits, quota?.data?.credits, quota, account),
      referrals: this.select(snapshots.referrals, referrals?.data?.referrals, referrals, account),
    }
  }

  private select<T>(snapshot: BenefitSample<T>, live: BenefitSample<T> | undefined, refresh: Sample<unknown> | undefined, account: AccountSample): BenefitSample<T> {
    // A status read that started before refresh must not replace its new result.
    // Failed persistence keeps the live result visible, with its original timestamp.
    return { ...(this.useSnapshot(live, refresh, account) ? snapshot : live!), error: account.error ? '账号信息读取失败，当前权益可能已过期' : refresh?.error ?? null }
  }

  private useSnapshot(live: BenefitSample<unknown> | undefined, refresh: Sample<unknown> | undefined, account: AccountSample) {
    return !live || (!live.warning && account.readStartedAt !== null && refresh?.updatedAt !== null && refresh?.updatedAt !== undefined && account.readStartedAt > refresh.updatedAt)
  }

  private async refresh(path: string, signal: AbortSignal): Promise<unknown> {
    try { return await this.upstream.request(path, { method: 'POST', signal }) }
    catch (error) {
      if (error instanceof UpstreamError && [404, 405].includes(error.status)) throw new Error('Sub2API 不支持此权益刷新接口，请检查版本')
      throw error
    }
  }
}

import { MoneyDecimal, normalizeMoney, type MoneyAmount } from '../shared/money'
import { dateInZone, subscriptionCycle, statisticsSnapshotTTL, type Account, type Intervals, type Sample, type SpendingRequest, type DailySpendingRequest, type TodayStats, type Usage, type UserRankingsRequest, type ModelRankingsRequest } from '../shared/domain'
import { DemandCache } from './cache'
import { normalizeAccount, normalizeToday, normalizeUsage, object } from './normalize'
import { UpstreamError, type Upstream } from './upstream'
import { Rankings } from './rankings'
import { ModelRankings } from './model-rankings'
import { Groups } from './groups'
import { Benefits } from './benefits'
import { AutoReset } from './auto-reset'
import type { AutoResetConfig } from '../shared/auto-reset'
import { AccountWriteLock } from './account-lock'
import { ResetCards } from './reset-card'
import { MemoryPersistence, type ManagerPersistence } from './persistence'
import type { ResetCardResult } from '../shared/reset-card'

interface SpendingScope { force: boolean; costs: Map<string, Promise<Sample<string>>>; admins?: Promise<Sample<number[]>>; statistics?: boolean }

export class Monitor {
  readonly groupManagement: Groups
  readonly accountBenefits: Benefits
  readonly accountAutoReset: AutoReset
  readonly accountResetCards: ResetCards
  private directoryCache = new DemandCache<Account[]>()
  private accountsCache = new DemandCache<{ account: Account; readStartedAt: number }>()
  private todayCache = new DemandCache<{ day: string; stats: TodayStats }>()
  private usageCache = new DemandCache<Usage>()
  private costCache = new DemandCache<string>()
  private spendingCache = new DemandCache<{ amount: MoneyAmount; updatedAt: number }>()
  private adminCache = new DemandCache<number[]>()
  private statisticsAdminCache = new DemandCache<number[]>()
  private statisticsAccountCache = new DemandCache<Account>()
  private statisticsCostCache = new DemandCache<string>()
  private batchUsageSupported = true
  private userRankings: Rankings
  private modelRanking: ModelRankings
  constructor(private upstream: Upstream, public intervals: Intervals, public serverTimeZone: string, persistence: ManagerPersistence = new MemoryPersistence()) {
    const accountLock = new AccountWriteLock()
    this.groupManagement = new Groups(upstream)
    this.accountBenefits = new Benefits(upstream, async id => (await this.detailSamples([id]))[id], persistence)
    this.accountAutoReset = new AutoReset(upstream, () => {
      this.directoryCache = new DemandCache<Account[]>()
      this.accountsCache = new DemandCache<{ account: Account; readStartedAt: number }>()
    }, accountLock)
    this.accountResetCards = new ResetCards(upstream, this.accountBenefits, persistence, accountLock, (id, result) => this.applyResetCard(id, result))
    this.userRankings = new Rankings(upstream, serverTimeZone, (signal, force) => this.statisticsAdmins(signal, force))
    this.modelRanking = new ModelRankings(upstream, (signal, force) => this.statisticsAdmins(signal, force))
  }

  private applyResetCard(id: number, result: ResetCardResult) {
    const now = Date.now(), account = result.account
    if (account) {
      this.accountsCache.set(String(id), { data: { account, readStartedAt: now }, updatedAt: now, error: null })
      const directory = this.directoryCache.peek('directory')
      if (directory?.data) this.directoryCache.set('directory', { ...directory, data: directory.data.map(v => v.id === id ? account : v) })
      else this.directoryCache.set('directory', { data: null, updatedAt: null, error: '目录待刷新' })
    } else {
      this.accountsCache.set(String(id), { data: null, updatedAt: null, error: '用卡后账号状态待更新' })
    }
    this.usageCache.set(String(id), result.quota ?? { data: null, updatedAt: null, error: '用卡后额度待更新，请手动查询并核对' })
  }

  private admins(signal: AbortSignal, force = false) {
    return this.adminCache.get('admins', this.intervals.spending * 1000, async () => (await this.directory('users', signal)).map(v => object(v).id as number), force)
  }
  private statisticsAdmins(signal: AbortSignal, force = false) {
    return this.statisticsAdminCache.get('admins', statisticsSnapshotTTL, async () => (await this.directory('users', signal)).map(v => object(v).id as number), force)
  }
  private statisticsAccounts(ids: number[], signal: AbortSignal, force: boolean) {
    return this.statisticsAccountCache.getMany(ids.map(String), statisticsSnapshotTTL, async missing => new Map<string, Account | Error>(await Promise.all(missing.map(async key => {
      try {
        const account = normalizeAccount(await this.upstream.request(`accounts/${key}`, { signal }))
        if (account.id !== Number(key)) throw new Error('账号响应不匹配')
        return [key, account] as const
      } catch (error) { return [key, error as Error] as const }
    }))), force)
  }
  rankings(input: UserRankingsRequest) { return this.userRankings.read(input) }
  modelRankings(input: ModelRankingsRequest) { return this.modelRanking.read(input) }

  private async directory(path: 'accounts' | 'users', signal: AbortSignal): Promise<unknown[]> {
    const values: unknown[] = [], seen = new Set<number>()
    for (let page = 1; page <= 100; page++) {
      const raw = object(await this.upstream.request(path, { signal, query: { page: String(page), page_size: '100', ...(path === 'accounts' ? { lite: 'true', include_scheduler_score: 'false' } : { role: 'admin' }) } }))
      if (!Array.isArray(raw.items) || !Number.isSafeInteger(raw.total) || (raw.total as number) < 0) throw new Error('目录响应格式不兼容')
      const previous = seen.size
      for (const item of raw.items) {
        const id = object(item).id
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('目录数据无效')
        if (path === 'users' && object(item).role !== 'admin') throw new Error('Admin 名单不完整，无法排除消费')
        if (!seen.has(id)) { seen.add(id); values.push(item) }
      }
      if (seen.size >= (raw.total as number)) return values
      if (seen.size === previous) throw new Error('目录分页异常')
    }
    throw new Error('目录超过可读取范围')
  }
  async accounts(force = false): Promise<Sample<Account[]>> {
    const cache = this.directoryCache
    const result = await cache.get('directory', 60_000, async () => (await this.directory('accounts', AbortSignal.timeout(30_000))).map(normalizeAccount), force)
    return cache === this.directoryCache ? result : this.accounts()
  }
  private async detailSamples(ids: number[], signal = AbortSignal.timeout(30_000), force = false): Promise<Record<number, Sample<Account> & { readStartedAt: number | null }>> {
    const cache = this.accountsCache
    const samples = await cache.getMany(ids.map(String), this.intervals.status * 1000, async missing => new Map<string, { account: Account; readStartedAt: number } | Error>(await Promise.all(missing.map(async id => {
      const readStartedAt = Date.now()
      try {
        const account = normalizeAccount(await this.upstream.request(`accounts/${id}`, { signal }))
        if (account.id !== Number(id)) throw new Error('账号响应不匹配')
        return [id, { account, readStartedAt }] as const
      } catch (error) { return [id, error as Error] as const }
    }))), force)
    if (cache !== this.accountsCache) return this.detailSamples(ids, signal)
    return Object.fromEntries(ids.map(id => {
      const sample = samples[id]
      return [id, { ...sample, data: sample.data?.account ?? null, readStartedAt: sample.data?.readStartedAt ?? null }]
    }))
  }
  async details(ids: number[], signal = AbortSignal.timeout(30_000), force = false) {
    const samples = await this.detailSamples(ids, signal, force)
    return Object.fromEntries(ids.map(id => {
      const { readStartedAt: _, ...sample } = samples[id]
      return [id, sample]
    }))
  }
  async autoResetConfig(id: number): Promise<Sample<AutoResetConfig>> {
    const sample = (await this.details([id]))[id]
    return { ...sample, data: sample.data?.autoReset ?? null }
  }
  async today(ids: number[], force = false) {
    const day = dateInZone(new Date(), this.serverTimeZone)
    const result = await this.todayCache.getMany(ids.map(String), this.intervals.status * 1000, async missing => {
      const raw = object(await this.upstream.request('accounts/today-stats/batch', { body: { account_ids: missing.map(Number) } }))
      const stats = object(raw.stats)
      return new Map<string, { day: string; stats: TodayStats } | Error>(missing.map(key => {
        try { return [key, { day, stats: normalizeToday(stats[key]) }] as const }
        catch (error) { return [key, error as Error] as const }
      }))
    }, force)
    return { day, items: Object.fromEntries(ids.map(id => {
      const sample = result[id]
      // Keep the throttle key stable across midnight, but never label yesterday as today.
      return [id, sample.data?.day === day
        ? { ...sample, data: sample.data.stats }
        : { data: null, updatedAt: null, error: sample.error }]
    })) }
  }
  async quota(ids: number[], force = false) {
    const signal = AbortSignal.timeout(30_000)
    const accounts = await this.details(ids, signal)
    const eligible = ids.filter(id => !accounts[id]?.error && accounts[id]?.data?.supportsUsage)
    return this.usageCache.getMany(eligible.map(String), this.intervals.quota * 1000, async missing => {
      if (this.batchUsageSupported) {
        try {
          const raw = object(await this.upstream.request('accounts/usage/batch', { body: { account_ids: missing.map(Number), force }, signal }))
          const usage = object(raw.usage), errors = object(raw.errors)
          return new Map<string, Usage | Error>(missing.map(id => {
            try {
              if (errors[id]) throw new Error('额度读取失败')
              return [id, normalizeUsage(usage[id], accounts[id].data!)] as const
            } catch (error) { return [id, error as Error] as const }
          }))
        } catch (error) {
          if (!(error instanceof UpstreamError) || ![404, 405].includes(error.status)) throw error
          this.batchUsageSupported = false
        }
      }
      return new Map<string, Usage | Error>(await Promise.all(missing.map(async id => {
        const account = accounts[id].data!
        try {
          const value = await this.upstream.request(`accounts/${id}/usage`, { signal, query: { source: account.platform === 'anthropic' ? 'passive' : 'active', force: String(force) } })
          return [id, normalizeUsage(value, account)] as const
        } catch (error) { return [id, error as Error] as const }
      })))
    }, force)
  }
  private async readSpending(accountId: number, start: string, day: string, timeZone: string, includeAdmin: boolean, signal: AbortSignal, scope: SpendingScope): Promise<Sample<MoneyAmount>> {
    // Only raw upstream scopes have a TTL. Recompute the projection from those
    // shared samples to avoid duplicating totals or adding a second stale window.
    // This zero-TTL cache coalesces calculations and retains the last valid result.
    const result = await this.spendingCache.get(JSON.stringify([accountId, start, day, timeZone, includeAdmin, !!scope.statistics]), 0, async () => {
      let admins: number[] = []
      const timestamps: number[] = []
      if (!includeAdmin) {
        const sample = await (scope.admins ??= scope.statistics ? this.statisticsAdmins(signal, scope.force) : this.admins(signal, scope.force))
        if (sample.error || !sample.data) throw new Error('Admin 名单读取失败，未生成排除 Admin 的统计')
        admins = sample.data
        timestamps.push(sample.updatedAt!)
      }
      const cost = async (userId?: number) => {
        const key = JSON.stringify([accountId, start, day, timeZone, userId ?? null])
        let pending = scope.costs.get(key)
        if (!pending) {
          pending = (scope.statistics ? this.statisticsCostCache : this.costCache).get(key, scope.statistics ? statisticsSnapshotTTL : this.intervals.spending * 1000, async () => {
          const raw = object(await this.upstream.request('usage/stats', { signal, query: {
            account_id: String(accountId), start_date: start, end_date: day, timezone: timeZone, nocache: 'true',
            ...(userId === undefined ? {} : { user_id: String(userId) }),
          } }))
          if (typeof raw.total_actual_cost !== 'number' && typeof raw.total_actual_cost !== 'string') throw new Error('消费数据缺失')
          const value = normalizeMoney(raw.total_actual_cost)
          if (value === null) throw new Error('消费数据无效')
          return value
          }, scope.force)
          scope.costs.set(key, pending)
        }
        const sample = await pending
        if (sample.error || sample.data === null) throw new Error(sample.error ?? '消费数据缺失')
        timestamps.push(sample.updatedAt!)
        return new MoneyDecimal(sample.data)
      }
      let excluded = new MoneyDecimal(0)
      for (const id of admins) excluded = excluded.plus(await cost(id))
      const amount = (await cost()).minus(excluded)
      const value = normalizeMoney(amount.toString())
      if (value === null) throw new Error('扣费统计口径不一致，请稍后重试')
      return { amount: value, updatedAt: Math.min(...timestamps) }
    }, scope.force)
    return { data: result.data?.amount ?? null, updatedAt: result.data?.updatedAt ?? null, error: result.error }
  }
  async dailySpending(input: DailySpendingRequest) {
    const day = dateInZone(new Date(), input.timeZone)
    const signal = AbortSignal.timeout(30_000)
    const scope: SpendingScope = { force: input.force === true, costs: new Map() }
    const accounts = await this.details(input.ids, signal)
    const items = await Promise.all(input.ids.map(async id => {
      const account = accounts[id]
      const value: Sample<MoneyAmount> = !account?.data || account.error
        ? { data: null, updatedAt: null, error: '账号消费暂不可用' }
        : await this.readSpending(id, day, day, input.timeZone, input.includeAdmin, signal, scope)
      return [id, value] as const
    }))
    return { day, items: Object.fromEntries(items) }
  }
  async spending(input: SpendingRequest, statistics = false) {
    const day = dateInZone(new Date(), input.timeZone)
    const signal = AbortSignal.timeout(30_000)
    const scope: SpendingScope = { force: input.force === true, costs: new Map(), statistics }
    const ids = input.subscriptions.map(s => s.accountId)
    const accounts = statistics ? await this.statisticsAccounts(ids, signal, scope.force) : await this.details(ids, signal)
    const rows = await Promise.all(input.subscriptions.map(async subscription => {
      const cycle = subscriptionCycle(day, subscription.renewalDay)
      const invalid = !!accounts[subscription.accountId]?.error || !accounts[subscription.accountId]?.data || accounts[subscription.accountId]?.data?.type !== 'oauth'
      const failure: Sample<MoneyAmount> = { data: null, updatedAt: null, error: invalid ? '仅可读取有效 OAuth 账号的订阅消费' : null }
      if (invalid) return { accountId: subscription.accountId, cycle, today: failure, spending: failure }
      const read = (start: string) => this.readSpending(subscription.accountId, start, day, input.timeZone, input.includeAdmin, signal, scope)
      const [spending, today] = await Promise.all([read(cycle.start), read(day)])
      return { accountId: subscription.accountId, cycle, spending, today }
    }))
    return { day, rows, ...(statistics ? { accounts } : {}) }
  }
}

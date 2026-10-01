import Decimal from 'decimal.js'
import { dateInZone, subscriptionCycle, type Account, type Intervals, type Sample, type SpendingRequest, type DailySpendingRequest, type SpendingRow, type TodayStats, type Usage, type UserRankingsRequest } from '../shared/domain'
import { DemandCache } from './cache'
import { normalizeAccount, normalizeToday, normalizeUsage, object } from './normalize'
import { UpstreamError, type Upstream } from './upstream'
import { Rankings } from './rankings'

interface SpendingScope { force: boolean; costs: Map<string, Promise<Sample<string>>>; admins?: Promise<Sample<number[]>> }

export class Monitor {
  private directoryCache = new DemandCache<Account[]>()
  private accountsCache = new DemandCache<Account>()
  private todayCache = new DemandCache<{ day: string; stats: TodayStats }>()
  private usageCache = new DemandCache<Usage>()
  private costCache = new DemandCache<string>()
  private spendingCache = new DemandCache<{ amount: number; updatedAt: number }>()
  private adminCache = new DemandCache<number[]>()
  private batchUsageSupported = true
  private userRankings: Rankings
  constructor(private upstream: Upstream, public intervals: Intervals, public serverTimeZone: string) {
    this.userRankings = new Rankings(upstream, () => this.intervals, serverTimeZone, (signal, force) => this.admins(signal, force))
  }

  private admins(signal: AbortSignal, force = false) {
    return this.adminCache.get('admins', this.intervals.spending * 1000, async () => (await this.directory('users', signal)).map(v => object(v).id as number), force)
  }
  rankings(input: UserRankingsRequest) { return this.userRankings.read(input) }

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
  accounts(force = false) {
    return this.directoryCache.get('directory', 60_000, async () => (await this.directory('accounts', AbortSignal.timeout(30_000))).map(normalizeAccount), force)
  }
  details(ids: number[], signal = AbortSignal.timeout(30_000), force = false) {
    return this.accountsCache.getMany(ids.map(String), this.intervals.status * 1000, async missing => new Map<string, Account | Error>(await Promise.all(missing.map(async id => {
      try {
        const account = normalizeAccount(await this.upstream.request(`accounts/${id}`, { signal }))
        if (account.id !== Number(id)) throw new Error('账号响应不匹配')
        return [id, account] as const
      } catch (error) { return [id, error as Error] as const }
    }))), force)
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
  private async readSpending(accountId: number, start: string, day: string, timeZone: string, includeAdmin: boolean, signal: AbortSignal, scope: SpendingScope): Promise<Sample<number>> {
    // Only raw upstream scopes have a TTL. Recompute the projection from those
    // shared samples to avoid duplicating totals or adding a second stale window.
    // This zero-TTL cache coalesces calculations and retains the last valid result.
    const result = await this.spendingCache.get(JSON.stringify([accountId, start, day, timeZone, includeAdmin]), 0, async () => {
      let admins: number[] = []
      const timestamps: number[] = []
      if (!includeAdmin) {
        const sample = await (scope.admins ??= this.admins(signal, scope.force))
        if (sample.error || !sample.data) throw new Error('Admin 名单读取失败，未生成排除 Admin 的统计')
        admins = sample.data
        timestamps.push(sample.updatedAt!)
      }
      const cost = async (userId?: number) => {
        const key = JSON.stringify([accountId, start, day, timeZone, userId ?? null])
        let pending = scope.costs.get(key)
        if (!pending) {
          pending = this.costCache.get(key, this.intervals.spending * 1000, async () => {
          const raw = object(await this.upstream.request('usage/stats', { signal, query: {
            account_id: String(accountId), start_date: start, end_date: day, timezone: timeZone, nocache: 'true',
            ...(userId === undefined ? {} : { user_id: String(userId) }),
          } }))
          if (typeof raw.total_actual_cost !== 'number' && typeof raw.total_actual_cost !== 'string') throw new Error('消费数据缺失')
          let value: Decimal
          try { value = new Decimal(raw.total_actual_cost) } catch { throw new Error('消费格式无效') }
          if (!value.isFinite() || value.isNegative()) throw new Error('消费数据无效')
          return value.toString()
          }, scope.force)
          scope.costs.set(key, pending)
        }
        const sample = await pending
        if (sample.error || sample.data === null) throw new Error(sample.error ?? '消费数据缺失')
        timestamps.push(sample.updatedAt!)
        return new Decimal(sample.data)
      }
      let excluded = new Decimal(0)
      for (const id of admins) excluded = excluded.plus(await cost(id))
      const amount = (await cost()).minus(excluded)
      if (amount.isNegative() || !Number.isFinite(amount.toNumber())) throw new Error('扣费统计口径不一致，请稍后重试')
      return { amount: amount.toNumber(), updatedAt: Math.min(...timestamps) }
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
      const value: Sample<number> = !account?.data || account.error
        ? { data: null, updatedAt: null, error: '账号消费暂不可用' }
        : await this.readSpending(id, day, day, input.timeZone, input.includeAdmin, signal, scope)
      return [id, value] as const
    }))
    return { day, items: Object.fromEntries(items) }
  }
  async spending(input: SpendingRequest): Promise<{ day: string; rows: SpendingRow[] }> {
    const day = dateInZone(new Date(), input.timeZone)
    const signal = AbortSignal.timeout(30_000)
    const scope: SpendingScope = { force: input.force === true, costs: new Map() }
    const accounts = await this.details(input.subscriptions.map(s => s.accountId), signal)
    const rows = await Promise.all(input.subscriptions.map(async subscription => {
      const cycle = subscriptionCycle(day, subscription.renewalDay)
      const invalid = !!accounts[subscription.accountId]?.error || !accounts[subscription.accountId]?.data || accounts[subscription.accountId]?.data?.type !== 'oauth'
      const failure: Sample<number> = { data: null, updatedAt: null, error: invalid ? '仅可读取有效 OAuth 账号的订阅消费' : null }
      if (invalid) return { accountId: subscription.accountId, cycle, today: failure, spending: failure }
      const read = (start: string) => this.readSpending(subscription.accountId, start, day, input.timeZone, input.includeAdmin, signal, scope)
      const [spending, today] = await Promise.all([read(cycle.start), read(day)])
      return { accountId: subscription.accountId, cycle, spending, today }
    }))
    return { day, rows }
  }
}

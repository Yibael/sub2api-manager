import Decimal from 'decimal.js'
import { dateInZone, subscriptionCycle, type Account, type Intervals, type Sample, type SpendingRequest, type DailySpendingRequest, type SpendingRow, type TodayStats, type Usage } from '../shared/domain'
import { DemandCache } from './cache'
import { normalizeAccount, normalizeToday, normalizeUsage, object } from './normalize'
import { UpstreamError, type Upstream } from './upstream'

export class Monitor {
  private directoryCache = new DemandCache<Account[]>()
  private accountsCache = new DemandCache<Account>()
  private todayCache = new DemandCache<TodayStats>()
  private usageCache = new DemandCache<Usage>()
  private spendingCache = new DemandCache<number>()
  private adminCache = new DemandCache<number[]>()
  private batchUsageSupported = true
  constructor(private upstream: Upstream, public intervals: Intervals, public serverTimeZone: string) {}

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
  accounts() {
    return this.directoryCache.get('directory', 60_000, async () => (await this.directory('accounts', AbortSignal.timeout(30_000))).map(normalizeAccount))
  }
  details(ids: number[]) {
    const signal = AbortSignal.timeout(30_000)
    return this.accountsCache.getMany(ids.map(String), this.intervals.status * 1000, async missing => new Map<string, Account | Error>(await Promise.all(missing.map(async id => {
      try {
        const account = normalizeAccount(await this.upstream.request(`accounts/${id}`, { signal }))
        if (account.id !== Number(id)) throw new Error('账号响应不匹配')
        return [id, account] as const
      } catch (error) { return [id, error as Error] as const }
    }))))
  }
  async today(ids: number[]) {
    const day = dateInZone(new Date(), this.serverTimeZone)
    const result = await this.todayCache.getMany(ids.map(id => `${day}:${id}`), this.intervals.status * 1000, async missing => {
      const raw = object(await this.upstream.request('accounts/today-stats/batch', { body: { account_ids: missing.map(key => Number(key.split(':')[1])) } }))
      const stats = object(raw.stats)
      return new Map<string, TodayStats | Error>(missing.map(key => {
        try { return [key, normalizeToday(stats[key.split(':')[1]])] as const }
        catch (error) { return [key, error as Error] as const }
      }))
    })
    return { day, items: Object.fromEntries(ids.map(id => [id, result[`${day}:${id}`]])) }
  }
  async quota(ids: number[]) {
    const accounts = await this.details(ids)
    const eligible = ids.filter(id => accounts[id]?.data?.supportsUsage)
    const signal = AbortSignal.timeout(30_000)
    return this.usageCache.getMany(eligible.map(String), this.intervals.quota * 1000, async missing => {
      if (this.batchUsageSupported) {
        try {
          const raw = object(await this.upstream.request('accounts/usage/batch', { body: { account_ids: missing.map(Number), force: false }, signal }))
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
          const value = await this.upstream.request(`accounts/${id}/usage`, { signal, query: { source: account.platform === 'anthropic' ? 'passive' : 'active', force: 'false' } })
          return [id, normalizeUsage(value, account)] as const
        } catch (error) { return [id, error as Error] as const }
      })))
    })
  }
  private readSpending(accountId: number, start: string, day: string, timeZone: string, includeAdmin: boolean, signal: AbortSignal) {
    return this.spendingCache.get(JSON.stringify([accountId, start, day, timeZone, includeAdmin]), this.intervals.spending * 1000, async () => {
        let admins: number[] = []
        if (!includeAdmin) {
          const result = await this.adminCache.get('admins', this.intervals.spending * 1000, async () => (await this.directory('users', signal)).map(v => object(v).id as number))
          if (result.error || !result.data) throw new Error('Admin 名单读取失败，未生成排除 Admin 的统计')
          admins = result.data
        }
        const cost = async (userId?: number) => {
          const raw = object(await this.upstream.request('usage/stats', { signal, query: {
            account_id: String(accountId), start_date: start, end_date: day, timezone: timeZone, nocache: 'true',
            ...(userId === undefined ? {} : { user_id: String(userId) }),
          } }))
          if (typeof raw.total_actual_cost !== 'number' && typeof raw.total_actual_cost !== 'string') throw new Error('消费数据缺失')
          let value: Decimal
          try { value = new Decimal(raw.total_actual_cost) } catch { throw new Error('消费格式无效') }
          if (!value.isFinite() || value.isNegative()) throw new Error('消费数据无效')
          return value
        }
        let excluded = new Decimal(0)
        for (const id of admins) excluded = excluded.plus(await cost(id))
        const amount = (await cost()).minus(excluded)
        if (amount.isNegative() || !Number.isFinite(amount.toNumber())) throw new Error('扣费统计口径不一致，请稍后重试')
        return amount.toNumber()
      })
  }
  async dailySpending(input: DailySpendingRequest) {
    const day = dateInZone(new Date(), input.timeZone)
    const accounts = await this.details(input.ids)
    const signal = AbortSignal.timeout(30_000)
    const items = await Promise.all(input.ids.map(async id => {
      const account = accounts[id]
      const value: Sample<number> = !account?.data || account.error
        ? { data: null, updatedAt: null, error: '账号消费暂不可用' }
        : await this.readSpending(id, day, day, input.timeZone, input.includeAdmin, signal)
      return [id, value] as const
    }))
    return { day, items: Object.fromEntries(items) }
  }
  async spending(input: SpendingRequest): Promise<{ day: string; rows: SpendingRow[] }> {
    const day = dateInZone(new Date(), input.timeZone)
    const accounts = await this.details(input.subscriptions.map(s => s.accountId))
    const signal = AbortSignal.timeout(30_000)
    const rows = await Promise.all(input.subscriptions.map(async subscription => {
      const cycle = subscriptionCycle(day, subscription.renewalDay)
      const invalid = !accounts[subscription.accountId]?.data || accounts[subscription.accountId]?.data?.type !== 'oauth'
      const failure: Sample<number> = { data: null, updatedAt: null, error: invalid ? '仅可读取有效 OAuth 账号的订阅消费' : null }
      if (invalid) return { accountId: subscription.accountId, cycle, today: failure, spending: failure }
      const read = (start: string) => this.readSpending(subscription.accountId, start, day, input.timeZone, input.includeAdmin, signal)
      const [spending, today] = await Promise.all([read(cycle.start), read(day)])
      return { accountId: subscription.accountId, cycle, spending, today }
    }))
    return { day, rows }
  }
}

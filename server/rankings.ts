import { MoneyDecimal, normalizeMoney } from '../shared/money'
import { userRankingPeriod, statisticsSnapshotTTL, type Sample, type UserRanking, type UserRankingsRequest, type UserSpendingRank } from '../shared/domain'
import { DemandCache } from './cache'
import { object } from './normalize'
import type { Upstream } from './upstream'

export const rankingLimit = 12
type TrendRow = UserSpendingRank & { period: string }
type RankingAggregate = { rows: UserSpendingRank[]; totalAmount: string }
type Projection = { ranking: UserRanking; updatedAt: number }

function count(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new Error('用户统计数据格式不兼容')
  return value
}
function parseAmount(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('用户消费数据缺失')
  const amount = normalizeMoney(value)
  if (amount === null) throw new Error('用户消费数据无效')
  return new MoneyDecimal(amount)
}
function rankRow(value: unknown): UserSpendingRank {
  const row = object(value)
  const userId = count(row.user_id, true)
  const name = [row.username, row.email].find(value => typeof value === 'string' && value.trim())
  return { userId, name: typeof name === 'string' ? name.trim().slice(0, 200) : `用户 #${userId}`, amount: parseAmount(row.actual_cost).toString(), requests: count(row.requests), tokens: count(row.tokens) }
}
function sum(rows: UserSpendingRank[]) { return rows.reduce((total, row) => total.plus(row.amount), new MoneyDecimal(0)) }
function sorted(rows: UserSpendingRank[]) {
  return [...rows].sort((a, b) => new MoneyDecimal(b.amount).cmp(a.amount) || b.tokens - a.tokens || a.userId - b.userId).slice(0, rankingLimit)
}
function combine(rows: UserSpendingRank[]): UserSpendingRank[] {
  const users = new Map<number, UserSpendingRank>()
  for (const row of rows) {
    const previous = users.get(row.userId)
    const amount = previous ? new MoneyDecimal(previous.amount).plus(row.amount).toString() : row.amount
    if (normalizeMoney(amount) === null) throw new Error('用户消费总计无效')
    users.set(row.userId, previous ? { ...row, amount,
      requests: count(previous.requests + row.requests), tokens: count(previous.tokens + row.tokens) } : row)
  }
  return [...users.values()]
}

/** Reads upstream aggregates only. Every cache is demand driven and shared across devices. */
export class Rankings {
  private rankingCache = new DemandCache<RankingAggregate>()
  private trendsCache = new DemandCache<TrendRow[]>()
  private adminCostCache = new DemandCache<string>()
  private projectionCache = new DemandCache<Projection>()
  constructor(private upstream: Upstream, private serverTimeZone: string,
    private readAdmins: (signal: AbortSignal, force: boolean) => Promise<Sample<number[]>>) {}

  private async readTrends(startDate: string, endDate: string, timeZone: string, granularity: 'day' | 'hour', signal: AbortSignal, force: boolean) {
    return this.trendsCache.get(JSON.stringify([startDate, endDate, timeZone, granularity]), statisticsSnapshotTTL, async () => {
      // The upstream first selects users by whole-range token volume. Expand the
      // selection until it includes all users, including deleted users in logs.
      // Two bounded requests; never present a truncated selection as an exact rank.
      for (const limit of [100, 1000]) {
        const raw = object(await this.upstream.request('dashboard/users-trend', { signal, query: {
          start_date: startDate, end_date: endDate, timezone: timeZone, granularity, limit: String(limit),
        } }))
        if (!Array.isArray(raw.trend) || raw.granularity !== granularity || raw.start_date !== startDate || raw.end_date !== endDate) throw new Error('用户趋势响应格式不兼容')
        const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 + 1
        if (raw.trend.length > limit * (granularity === 'hour' ? 25 : days + 2)) throw new Error('用户趋势数据超过可读取范围')
        const seen = new Set<string>(), users = new Set<number>()
        const rows = raw.trend.map(value => {
          const row = rankRow(value), period = object(value).date
          if (typeof period !== 'string' || !(granularity === 'hour' ? /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):00$/ : /^\d{4}-\d{2}-\d{2}$/).test(period)) throw new Error('用户趋势时间格式不兼容')
          const identity = JSON.stringify([row.userId, period])
          if (seen.has(identity)) throw new Error('用户趋势返回重复数据')
          seen.add(identity); users.add(row.userId)
          return { ...row, period }
        })
        if (users.size < limit) return rows
      }
      throw new Error('用户趋势范围不完整，暂时无法生成准确排行')
    }, force)
  }

  async read(input: UserRankingsRequest): Promise<Sample<UserRanking>> {
    const period = userRankingPeriod(input.range, new Date(), input.timeZone, this.serverTimeZone)
    const { startDate, endDate, timeZone } = period
    const force = input.force === true, signal = AbortSignal.timeout(30_000)
    const excluded = async () => {
      if (input.includeAdmin) return { ids: new Set<number>(), updatedAt: Infinity }
      const sample = await this.readAdmins(signal, force)
      if (sample.error || !sample.data || sample.updatedAt === null) throw new Error('Admin 名单读取失败，未生成排除 Admin 的排行')
      return { ids: new Set(sample.data), updatedAt: sample.updatedAt }
    }
    const sample = await this.projectionCache.get(JSON.stringify([input.range, period.period, timeZone, input.includeAdmin]), 0, async () => {
      const admin = await excluded()
      let rows: UserSpendingRank[], total: InstanceType<typeof MoneyDecimal>, updatedAt: number
      if (input.range !== 'hour') {
        const ranking = await this.rankingCache.get(JSON.stringify([startDate, endDate, timeZone]), statisticsSnapshotTTL, async () => {
          const raw = object(await this.upstream.request('dashboard/users-ranking', { signal, query: {
            start_date: startDate, end_date: endDate, timezone: timeZone, limit: '50',
          } }))
          if (!Array.isArray(raw.ranking) || raw.ranking.length > 50 || raw.start_date !== startDate || raw.end_date !== endDate) throw new Error('用户排行榜响应格式不兼容')
          const rows = raw.ranking.map(rankRow)
          if (new Set(rows.map(row => row.userId)).size !== rows.length) throw new Error('用户排行榜返回重复数据')
          return { rows, totalAmount: parseAmount(raw.total_actual_cost).toString() }
        }, force)
        if (ranking.error || ranking.data === null) throw new Error(ranking.error ?? '用户消费排行暂不可用')
        const aggregate = ranking.data
        rows = aggregate.rows.filter(row => !admin.ids.has(row.userId))
        updatedAt = ranking.updatedAt!
        total = new MoneyDecimal(aggregate.totalAmount)
        if (aggregate.rows.length === 50 && rows.length < rankingLimit) {
          // More than 38 Admins in the upstream top 50 can hide eligible users.
          // Fall back to complete daily aggregates, without reading usage logs.
          const trend = await this.readTrends(startDate, endDate, timeZone, 'day', signal, force)
          if (trend.error || trend.data === null) throw new Error(trend.error ?? '用户消费排行范围不完整')
          rows = combine(trend.data.filter(row => !admin.ids.has(row.userId)))
          total = sum(rows)
          updatedAt = trend.updatedAt!
        } else {
          // The upstream total covers all users before LIMIT. Deduct every Admin,
          // including those outside the returned ranking, without reading logs.
          const ranked = new Map(aggregate.rows.map(row => [row.userId, row.amount]))
          for (const id of admin.ids) {
            const known = ranked.get(id)
            if (known !== undefined) { total = total.minus(known); continue }
            const cost = await this.adminCostCache.get(JSON.stringify([startDate, endDate, timeZone, id]), statisticsSnapshotTTL, async () => {
              const raw = object(await this.upstream.request('usage/stats', { signal, query: {
                start_date: startDate, end_date: endDate, timezone: timeZone, user_id: String(id), nocache: 'true',
              } }))
              return parseAmount(raw.total_actual_cost).toString()
            }, force)
            if (cost.error || cost.data === null) throw new Error(cost.error ?? 'Admin 消费读取失败，未生成总消费')
            total = total.minus(cost.data); updatedAt = Math.min(updatedAt, cost.updatedAt!)
          }
        }
      } else {
        // The upstream formats hour buckets in its server/database timezone.
        // timezone changes date bounds, not the returned bucket timezone.
        const trend = await this.readTrends(startDate, endDate, timeZone, 'hour', signal, force)
        if (trend.error || trend.data === null) throw new Error(trend.error ?? '本小时消费排行暂不可用')
        rows = trend.data.filter(row => row.period === period.period && !admin.ids.has(row.userId))
        total = sum(rows)
        updatedAt = trend.updatedAt!
      }
      const totalAmount = normalizeMoney(total.toString())
      if (totalAmount === null) throw new Error('总消费统计口径不一致，请稍后重试')
      return { ranking: { ...period, range: input.range, rows: sorted(rows), totalAmount }, updatedAt: Math.min(updatedAt, admin.updatedAt) }
    }, force)
    return { data: sample.data?.ranking ?? null, updatedAt: sample.data?.updatedAt ?? null, error: sample.error }
  }
}

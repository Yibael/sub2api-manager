import { MoneyDecimal, normalizeMoney, sumMoney } from '../shared/money'
import { userRankingPeriod, rankingInterval, type Intervals, type ModelRanking, type ModelRankingsRequest, type ModelUsageRank, type Sample } from '../shared/domain'
import { DemandCache } from './cache'
import { object } from './normalize'
import { rankingLimit } from './rankings'
import type { Upstream } from './upstream'

type Projection = { ranking: ModelRanking; updatedAt: number }

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('模型用量统计数据无效')
  return value
}
function parseRows(value: unknown): ModelUsageRank[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('模型统计响应格式不兼容')
  const seen = new Set<string>()
  return value.map(value => {
    const row = object(value), amount = normalizeMoney(row.actual_cost)
    if (typeof row.model !== 'string' || !row.model.trim() || row.model.length > 500 || amount === null) throw new Error('模型统计数据缺失或无效')
    const model = row.model.trim()
    if (seen.has(model)) throw new Error('模型统计返回重复数据')
    seen.add(model)
    return { model, amount, requests: count(row.requests), tokens: count(row.total_tokens) }
  })
}

/** Uses complete model aggregates. No usage log pagination or provider requests. */
export class ModelRankings {
  private aggregates = new DemandCache<ModelUsageRank[]>()
  private projections = new DemandCache<Projection>()
  constructor(private upstream: Upstream, private intervals: () => Intervals,
    private readAdmins: (signal: AbortSignal, force: boolean) => Promise<Sample<number[]>>) {}

  async read(input: ModelRankingsRequest): Promise<Sample<ModelRanking>> {
    const period = userRankingPeriod(input.range, new Date(), input.timeZone, input.timeZone)
    const { startDate, endDate, timeZone } = period
    const interval = rankingInterval(this.intervals()) * 1000, force = input.force === true
    const signal = AbortSignal.timeout(30_000)
    const projection = await this.projections.get(JSON.stringify([input.range, period.period, timeZone, input.includeAdmin]), 0, async () => {
      let admins: number[] = [], updatedAt = Infinity
      if (!input.includeAdmin) {
        const sample = await this.readAdmins(signal, force)
        if (sample.error || !sample.data || sample.updatedAt === null) throw new Error('Admin 名单读取失败，未生成排除 Admin 的模型榜')
        admins = [...new Set(sample.data)]; updatedAt = sample.updatedAt
      }
      const read = async (userId?: number) => {
        const sample = await this.aggregates.get(JSON.stringify([startDate, endDate, timeZone, userId ?? null]), interval, async () => {
          const raw = object(await this.upstream.request('dashboard/models', { signal, query: {
            start_date: startDate, end_date: endDate, timezone: timeZone, model_source: 'requested',
            ...(userId === undefined ? {} : { user_id: String(userId) }),
          } }))
          if (raw.start_date !== startDate || raw.end_date !== endDate) throw new Error('模型统计时间范围不匹配')
          return parseRows(raw.models)
        }, force)
        if (sample.error || !sample.data || sample.updatedAt === null) throw new Error(sample.error ?? '模型用量统计暂不可用')
        updatedAt = Math.min(updatedAt, sample.updatedAt)
        return sample.data
      }
      const all = await read()
      const rows = new Map(all.map(row => [row.model, { ...row }]))
      // The upstream cannot exclude roles. Subtract each Admin's complete model
      // aggregate; incomplete or inconsistent dependencies retain the last result.
      for (const id of admins) {
        for (const excluded of await read(id)) {
          if (!excluded.requests && !excluded.tokens && new MoneyDecimal(excluded.amount).isZero()) continue
          const row = rows.get(excluded.model)
          const amount = row && normalizeMoney(new MoneyDecimal(row.amount).minus(excluded.amount).toString())
          if (!row || amount === null || amount === undefined || row.requests < excluded.requests || row.tokens < excluded.tokens) throw new Error('模型统计口径不一致，请稍后刷新')
          row.amount = amount; row.requests -= excluded.requests; row.tokens -= excluded.tokens
        }
      }
      const eligible = [...rows.values()].filter(row => row.requests > 0 || row.tokens > 0 || !new MoneyDecimal(row.amount).isZero())
      const totalAmount = normalizeMoney(sumMoney(eligible.map(row => row.amount)))
      if (totalAmount === null) throw new Error('模型总消费无效')
      eligible.sort((a, b) => new MoneyDecimal(b.amount).cmp(a.amount) || b.tokens - a.tokens || a.model.localeCompare(b.model, 'en'))
      return { ranking: { ...period, range: input.range, rows: eligible.slice(0, rankingLimit), totalAmount }, updatedAt }
    }, force)
    return { data: projection.data?.ranking ?? null, updatedAt: projection.data?.updatedAt ?? null, error: projection.error }
  }
}

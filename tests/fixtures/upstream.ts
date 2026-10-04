import type { Upstream } from '../../server/upstream'
import { hourInZone } from '../../shared/domain'

export const fixtureAccounts = [
  { id: 1, name: '主力账号', platform: 'openai', type: 'oauth', status: 'active', schedulable: true, concurrency: 8, current_concurrency: 3 },
  { id: 2, name: '日常开发', platform: 'anthropic', type: 'oauth', status: 'active', schedulable: true, concurrency: 5, current_concurrency: 1 },
  { id: 3, name: '备用账号', platform: 'gemini', type: 'oauth', status: 'active', schedulable: true, concurrency: 4, current_concurrency: 0 },
  { id: 4, name: 'API 服务', platform: 'openai', type: 'apikey', status: 'active', schedulable: true, concurrency: 10, current_concurrency: 2,
    quota_daily_limit: 20, quota_daily_used: 7.64, quota_weekly_limit: 100, quota_weekly_used: 41.2 },
]
/** Deterministic upstream responses for tests only. */
export const fixtureUpstream: Upstream = {
  async request(path, options = {}) {
    if (path === 'accounts') return { total: fixtureAccounts.length, items: fixtureAccounts }
    if (path === 'users') return { total: 1, items: [{ id: 7, role: 'admin' }] }
    if (path === 'dashboard/models') {
      const query = options.query!, days = (Date.parse(query.end_date) - Date.parse(query.start_date)) / 86_400_000 + 1
      const models = query.user_id ? [
        { model: 'gpt-5.2', actual_cost: 20.8, requests: 100, total_tokens: 1_400_000 },
        { model: 'claude-sonnet-4-5', actual_cost: 3.18, requests: 14, total_tokens: 300_000 },
        { model: 'gemini-2.5-pro', actual_cost: 0.62, requests: 6, total_tokens: 100_000 },
      ] : [
        { model: 'gpt-5.2', actual_cost: 31.4, requests: 180, total_tokens: 2_500_000 },
        { model: 'claude-sonnet-4-5', actual_cost: 12.84, requests: 86, total_tokens: 1_200_000 },
        { model: 'gemini-2.5-pro', actual_cost: 5.96, requests: 35, total_tokens: 600_000 },
      ]
      return { start_date: query.start_date, end_date: query.end_date,
        models: models.map(row => ({ ...row, actual_cost: row.actual_cost * days, requests: row.requests * days, total_tokens: row.total_tokens * days })) }
    }
    if (path === 'dashboard/users-ranking') {
      const days = (Date.parse(options.query!.end_date) - Date.parse(options.query!.start_date)) / 86_400_000 + 1
      return {
        start_date: options.query!.start_date, end_date: options.query!.end_date,
        ranking: [
          { user_id: 7, email: 'admin@example.test', actual_cost: 24.6, requests: 120, tokens: 1_800_000 },
          { user_id: 11, email: 'developer@example.test', actual_cost: 12.84, requests: 86, tokens: 1_200_000 },
          { user_id: 12, email: 'design@example.test', actual_cost: 8.26, requests: 54, tokens: 640_000 },
          { user_id: 13, email: 'research@example.test', actual_cost: 3.18, requests: 23, tokens: 420_000 },
          { user_id: 14, email: 'automation@example.test', actual_cost: 1.32, requests: 18, tokens: 240_000 },
        ].map(row => ({ ...row, actual_cost: row.actual_cost * days, requests: row.requests * days, tokens: row.tokens * days })),
        total_actual_cost: 50.2 * days, total_requests: 301 * days, total_tokens: 4_300_000 * days,
      }
    }
    if (path === 'dashboard/users-trend') return {
      start_date: options.query!.start_date, end_date: options.query!.end_date, granularity: options.query!.granularity,
      trend: [
        { user_id: 7, email: 'admin@example.test', actual_cost: 1.48, requests: 14, tokens: 180_000 },
        { user_id: 12, username: '产品设计', actual_cost: 0.86, requests: 12, tokens: 64_000 },
        { user_id: 11, username: '日常开发', actual_cost: 0.42, requests: 8, tokens: 120_000 },
        { user_id: 13, username: '研究任务', actual_cost: 0.18, requests: 3, tokens: 42_000 },
      ].map(row => ({ ...row, date: options.query!.granularity === 'hour' ? hourInZone(new Date(), options.query!.timezone) : options.query!.start_date })),
    }
    const match = /^accounts\/(\d+)$/.exec(path)
    if (match) return fixtureAccounts.find(a => a.id === Number(match[1]))
    const ids = (options.body as { account_ids?: number[] } | undefined)?.account_ids ?? []
    if (path === 'accounts/today-stats/batch') return { stats: Object.fromEntries(ids.map(id => [id, { standard_cost: [0, 12.84, 8.26, 1.32, 7.64][id], cost: 4.21 * id, user_cost: 3.12 * id, requests: 138 * id, tokens: 1_420_000 * id }])) }
    if (path === 'accounts/usage/batch') return { usage: Object.fromEntries(ids.map(id => [id, {
      five_hour: { utilization: [0, 28, 64, 12][id], resets_at: new Date(Date.now() + 7_200_000).toISOString() },
      seven_day: { utilization: [0, 42, 76, 18][id], resets_at: new Date(Date.now() + 172_800_000).toISOString(), window_stats: { cost: 36.4 * id } },
    }])) }
    if (path === 'usage/stats') {
      const q = options.query!
      return { total_actual_cost: q.user_id ? 0.42 : Number(q.account_id) * (q.start_date === q.end_date ? 3.18 : 24.6) }
    }
    throw new Error('Unexpected fixture request')
  },
}

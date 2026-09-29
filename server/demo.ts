import type { Upstream } from './upstream'

export const demoAccounts = [
  { id: 1, name: '主力账号', platform: 'openai', type: 'oauth', status: 'active', schedulable: true, concurrency: 8, current_concurrency: 3 },
  { id: 2, name: '日常开发', platform: 'anthropic', type: 'oauth', status: 'active', schedulable: true, concurrency: 5, current_concurrency: 1 },
  { id: 3, name: '备用账号', platform: 'gemini', type: 'oauth', status: 'active', schedulable: true, concurrency: 4, current_concurrency: 0 },
  { id: 4, name: 'API 服务', platform: 'openai', type: 'apikey', status: 'active', schedulable: true, concurrency: 10, current_concurrency: 2,
    quota_daily_limit: 20, quota_daily_used: 7.64, quota_weekly_limit: 100, quota_weekly_used: 41.2 },
]
/** Explicitly enabled, isolated demonstration data. Never contacts a real upstream. */
export const demoUpstream: Upstream = {
  async request(path, options = {}) {
    if (path === 'accounts') return { total: demoAccounts.length, items: demoAccounts }
    if (path === 'users') return { total: 1, items: [{ id: 7, role: 'admin' }] }
    const match = /^accounts\/(\d+)$/.exec(path)
    if (match) return demoAccounts.find(a => a.id === Number(match[1]))
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
    throw new Error('演示接口不存在')
  },
}

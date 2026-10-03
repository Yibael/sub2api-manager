import type { Upstream } from '../../server/upstream'
import { fixtureUpstream } from './upstream'

export function createGroupsFixture() {
  const groups = [
    { id: 1, name: 'OpenAI 日常', description: '日常开发与轻量任务', platform: 'openai', status: 'active', rate_multiplier: 1, subscription_type: 'standard', is_exclusive: false, account_count: 4, image_rate_independent: false, updated_at: '2026-10-03T00:00:00Z' },
    { id: 2, name: 'Claude 专属', description: '订阅分组', platform: 'anthropic', status: 'active', rate_multiplier: 0.125, subscription_type: 'subscription', is_exclusive: true, account_count: 2, image_rate_independent: false, updated_at: '2026-10-03T00:00:00Z' },
    { id: 3, name: 'Gemini 图像', description: '图片使用独立计费倍率', platform: 'gemini', status: 'active', rate_multiplier: 0.75, subscription_type: 'standard', is_exclusive: false, account_count: 3, image_rate_independent: true, updated_at: '2026-10-03T00:00:00Z' },
    { id: 4, name: '备用分组', description: '', platform: 'openai', status: 'inactive', rate_multiplier: 1.5, subscription_type: 'standard', is_exclusive: false, account_count: 0, image_rate_independent: false, updated_at: '2026-10-03T00:00:00Z' },
  ]
  let revision = 0
  const upstream: Upstream = { async request(path, options) {
    if (path === 'groups') return structuredClone({ total: groups.length, items: groups })
    const match = /^groups\/(\d+)$/.exec(path)
    if (match) {
      const group = groups.find(value => value.id === Number(match[1]))
      if (!group) throw new Error('分组不存在')
      if (options?.method === 'PUT') {
        group.rate_multiplier = (options.body as { rate_multiplier: number }).rate_multiplier
        group.updated_at = new Date(Date.parse('2026-10-03T00:00:00Z') + ++revision * 1000).toISOString()
      }
      return structuredClone(group)
    }
    return fixtureUpstream.request(path, options)
  } }
  return { groups, upstream }
}

import { z } from 'zod'

export const intervalsSchema = z.object({
  status: z.union([z.literal(2), z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  quota: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60), z.literal(120)]),
  spending: z.union([z.literal(2), z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60), z.literal(120)]),
})
export type Intervals = z.infer<typeof intervalsSchema>
export const defaultIntervals: Intervals = { status: 5, quota: 30, spending: 15 }
export const timezoneSchema = z.string().max(80).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, '请输入有效的 IANA 时区，例如 Asia/Shanghai')
export const subscriptionSchema = z.object({
  accountId: z.number().int().positive(), price: z.number().finite().min(0).max(1e9), renewalDay: z.number().int().min(1).max(31),
})
export type Subscription = z.infer<typeof subscriptionSchema>
export const spendingRequestSchema = z.object({
  subscriptions: z.array(subscriptionSchema).max(100), timeZone: timezoneSchema, includeAdmin: z.boolean(),
}).refine(value => new Set(value.subscriptions.map(s => s.accountId)).size === value.subscriptions.length, '账号不能重复')
export type SpendingRequest = z.infer<typeof spendingRequestSchema>
export const dailySpendingRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).max(100).transform(ids => [...new Set(ids)]),
  timeZone: timezoneSchema, includeAdmin: z.boolean(),
})
export type DailySpendingRequest = z.infer<typeof dailySpendingRequestSchema>
export interface Sample<T> { data: T | null; updatedAt: number | null; error: string | null }
export interface Quota { name: string; percent: number | null; used: number | null; limit: number | null; resetsAt: string | null }
export interface Account {
  id: number; name: string; platform: string; type: string; status: string;
  schedulable: boolean | null; concurrency: number | null; currentConcurrency: number | null;
  rateLimitResetAt: string | null; overloadUntil: string | null; tempUnschedulableUntil: string | null;
  supportsUsage: boolean; localQuotas: Quota[];
}
export interface TodayStats { standardCost: number | null; accountCost: number | null; userCost: number | null; requests: number | null; tokens: number | null }
export interface Usage { windows: Quota[]; weeklyCost: number | null; estimatedWeeklyCost: number | null }
export interface Cycle { start: string; end: string; next: string }
export interface SpendingRow { accountId: number; cycle: Cycle; today: Sample<number>; spending: Sample<number> }
export interface PublicConfig { configured: boolean; authenticated: boolean; instanceId: string; instanceName: string; serverUrl: string; serverTimeZone: string; intervals: Intervals }

export function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function subscriptionCycle(today: string, renewalDay: number): Cycle {
  const [year, month] = today.split('-').map(Number)
  const boundary = (offset: number) => {
    const first = new Date(Date.UTC(year, month - 1 + offset, 1))
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(renewalDay, lastDay))).toISOString().slice(0, 10)
  }
  const start = today >= boundary(0) ? boundary(0) : boundary(-1)
  const next = today >= boundary(0) ? boundary(1) : boundary(0)
  const end = new Date(new Date(`${next}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
  return { start, end, next }
}
export function accountState(account: Account, now = Date.now()): string {
  if (account.status === 'error') return '账号异常'
  if (['inactive', 'disabled'].includes(account.status)) return '已停用'
  if (account.rateLimitResetAt && Date.parse(account.rateLimitResetAt) > now) return '限流中'
  if (account.overloadUntil && Date.parse(account.overloadUntil) > now) return '过载中'
  if (account.tempUnschedulableUntil && Date.parse(account.tempUnschedulableUntil) > now) return '暂不可调度'
  if (account.schedulable === false) return '已停调度'
  if (account.localQuotas.some(q => (q.percent ?? 0) >= 100 && (!q.resetsAt || Date.parse(q.resetsAt) > now))) return '额度已用尽'
  return account.status === 'active' ? '可调度' : '状态未知'
}
export const providerNames: Record<string, string> = { openai: 'OpenAI', anthropic: 'Claude', gemini: 'Gemini', antigravity: 'Antigravity', grok: 'Grok' }

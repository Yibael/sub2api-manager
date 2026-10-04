import type { Account, Quota, TodayStats, Usage } from '../shared/domain'
import { MoneyDecimal, normalizeMoney } from '../shared/money'
import type { AccountBenefits, BenefitSample, CodexCredits, ReferralCapacity, ResetCredits } from '../shared/benefits'
import type { AutoResetConfig } from '../shared/auto-reset'

export type Raw = Record<string, unknown>
export const object = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {}
export const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export const string = (value: unknown): string | null => typeof value === 'string' ? value : null
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
const count = (value: unknown) => { const n = number(value); return n !== null && Number.isSafeInteger(n) ? n : null }
export function benefitSample<T>(data: T | null, updatedAt: number | null = null): BenefitSample<T> {
  return { data, updatedAt, error: null, warning: null }
}
export function fetchedAt(value: unknown): number | null {
  const seconds = count(value)
  return seconds && Number.isFinite(new Date(seconds * 1000).getTime()) ? seconds * 1000 : null
}
export function normalizeResetCredits(value: unknown): ResetCredits | null {
  const raw = object(value), availableCount = count(raw.available_count)
  if (availableCount === null) return null
  const expiresAt = Array.isArray(raw.credits) ? raw.credits.flatMap(credit => {
    const time = date(object(credit).expires_at)
    return time ? [new Date(time).toISOString()] : []
  }).sort() : []
  return { availableCount, expiresAt }
}
export function normalizeCredits(value: unknown): CodexCredits | null {
  const raw = object(value)
  if (typeof raw.has_credits !== 'boolean' || typeof raw.unlimited !== 'boolean') return null
  return { hasCredits: raw.has_credits, unlimited: raw.unlimited,
    balance: typeof raw.balance === 'string' && raw.balance.length <= 200 ? normalizeMoney(raw.balance) : null }
}
export function normalizeReferrals(value: unknown): ReferralCapacity | null {
  const raw = object(value)
  if (typeof raw.should_show !== 'boolean' && count(raw.available_invites) === null) return null
  return { availableInvites: raw.should_show === false ? 0 : count(raw.available_invites) }
}
export function normalizeBenefits(extra: Raw): AccountBenefits {
  const credits = object(extra.codex_credits_snapshot), referrals = object(extra.codex_referral_snapshot)
  return {
    resetCredits: benefitSample(normalizeResetCredits(extra.codex_reset_credit_snapshot), fetchedAt(object(extra.codex_reset_credit_snapshot).fetched_at)),
    credits: benefitSample(normalizeCredits(credits.credits), fetchedAt(credits.fetched_at)),
    referrals: benefitSample(normalizeReferrals(referrals), fetchedAt(referrals.fetched_at)),
  }
}

/** The quota/refresh and reset-quota endpoints return WHAM windows directly. */
export function normalizeOpenAIQuota(value: unknown): Usage {
  const raw = object(value), limit = object(raw.rate_limit), queriedAt = fetchedAt(raw.fetched_at)
  const windows: Quota[] = []
  for (const [key, fallback] of [['primary_window', '5小时额度'], ['secondary_window', '7日额度']]) {
    const window = object(limit[key]), percent = number(window.used_percent)
    if (percent === null) continue
    const resetAt = fetchedAt(window.reset_at)
    const after = number(window.reset_after_seconds)
    const time = resetAt ?? (queriedAt !== null && after !== null ? queriedAt + after * 1000 : null)
    windows.push({ name: window.limit_window_seconds === 604800 ? '7日额度' : window.limit_window_seconds === 18000 ? '5小时额度' : fallback,
      percent, resetsAt: time !== null && Number.isFinite(new Date(time).getTime()) ? new Date(time).toISOString() : null, used: null, limit: null })
  }
  return { windows, weeklyCost: null, estimatedWeeklyCost: null }
}
export function resetThreshold(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0.001 && parsed <= 1 ? parsed : null
}
export function normalizeAutoReset(raw: Raw): AutoResetConfig | null {
  if (raw.platform !== 'openai' || raw.type !== 'oauth' || raw.parent_account_id != null) return null
  const extra = object(raw.extra)
  const enabled = extra.auto_reset_credit_enabled
  return { enabled: enabled === true || typeof enabled === 'number' && enabled !== 0 || typeof enabled === 'string' && ['1', 't', 'T', 'TRUE', 'true', 'True'].includes(enabled.trim()),
    threshold5h: resetThreshold(extra.auto_reset_credit_5h_threshold) ?? 1, threshold7d: resetThreshold(extra.auto_reset_credit_7d_threshold) ?? 1 }
}
export function normalizeAccount(value: unknown): Account {
  const raw = object(value)
  const id = count(raw.id)
  if (!id) throw new Error('账号响应格式不兼容')
  const platform = string(raw.platform) ?? 'unknown'
  const type = string(raw.type) ?? 'unknown'
  const apiKey = ['apikey', 'api_key', 'api-key', 'bedrock'].includes(type)
  const supportsUsage = platform === 'anthropic' ? ['oauth', 'setup-token'].includes(type)
    : platform === 'gemini' ? type === 'oauth' || apiKey
      : ['openai', 'antigravity', 'grok'].includes(platform) && type === 'oauth'
  const extra = object(raw.extra)
  const localQuotas: Quota[] = []
  if (apiKey) for (const [prefix, name, days] of [['quota_daily', '日额度', 1], ['quota_weekly', '7日额度', 7], ['quota', '总额度', 0]] as const) {
    const limit = normalizeMoney(raw[`${prefix}_limit`])
    if (limit === null || new MoneyDecimal(limit).lte(0)) continue
    const used = normalizeMoney(raw[`${prefix}_used`])
    const mode = raw[`${prefix}_reset_mode`] ?? extra[`${prefix}_reset_mode`]
    let resetsAt = null
    if (days && mode === 'fixed') resetsAt = date(raw[`${prefix}_reset_at`] ?? extra[`${prefix}_reset_at`])
    else if (days && (mode === undefined || mode === null || mode === 'rolling')) {
      const start = date(extra[`${prefix}_start`])
      if (start) resetsAt = new Date(Date.parse(start) + days * 86400000).toISOString()
    }
    localQuotas.push({ name, limit, used, percent: used === null ? null : new MoneyDecimal(used).div(limit).times(100).toNumber(), resetsAt })
  }
  // An allowlist is intentional: credentials, tokens and arbitrary extra never leave the server.
  return { id, name: string(raw.name) ?? `账号 ${id}`, platform, type, status: string(raw.status) ?? 'unknown',
    schedulable: typeof raw.schedulable === 'boolean' ? raw.schedulable : null,
    concurrency: count(raw.concurrency), currentConcurrency: count(raw.current_concurrency),
    rateLimitResetAt: date(raw.rate_limit_reset_at), overloadUntil: date(raw.overload_until),
    tempUnschedulableUntil: date(raw.temp_unschedulable_until), supportsUsage, localQuotas,
    benefits: platform === 'openai' && type === 'oauth' ? normalizeBenefits(extra) : null, autoReset: normalizeAutoReset(raw) }
}
export function normalizeToday(value: unknown): TodayStats {
  if (!value || typeof value !== 'object') throw new Error('今日统计暂不可用')
  const raw = object(value)
  return { standardCost: normalizeMoney(raw.standard_cost), accountCost: normalizeMoney(raw.cost), userCost: normalizeMoney(raw.user_cost), requests: count(raw.requests), tokens: count(raw.tokens) }
}
export function normalizeUsage(value: unknown, account: Account): Usage {
  const raw = object(value)
  if (!value || raw.error || raw.error_code || raw.is_forbidden || raw.needs_reauth) throw new Error('额度暂不可用，请检查上游账号状态')
  const windows: Quota[] = []
  for (const [key, name] of [['five_hour', '5小时额度'], ['seven_day', '7日额度'], ['seven_day_sonnet', 'Sonnet 7日额度'], ['gemini_shared_daily', '共享日额度'], ['gemini_pro_daily', 'Pro 日额度'], ['gemini_flash_daily', 'Flash 日额度']]) {
    if (!raw[key]) continue
    const window = object(raw[key])
    windows.push({ name, percent: number(window.utilization), resetsAt: date(window.resets_at), used: null, limit: null })
  }
  const sevenDay = object(raw.seven_day)
  const weeklyCost = normalizeMoney(object(sevenDay.window_stats).cost)
  const percent = number(sevenDay.utilization)
  const estimate = account.platform === 'openai' && account.type === 'oauth' && weeklyCost !== null && percent && new MoneyDecimal(weeklyCost).gt(0)
    ? new MoneyDecimal(weeklyCost).times(100).div(percent).toString() : null
  return { windows, weeklyCost, estimatedWeeklyCost: normalizeMoney(estimate) }
}

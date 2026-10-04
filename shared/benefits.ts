import type { Sample } from './domain'
import { MoneyDecimal } from './money'

export interface ResetCredits { availableCount: number; expiresAt: string[] }
export interface CodexCredits { hasCredits: boolean; unlimited: boolean; balance: string | null }
export interface ReferralCapacity { availableInvites: number | null }
export interface BenefitSample<T> extends Sample<T> { warning: string | null }
export interface AccountBenefits {
  resetCredits: BenefitSample<ResetCredits>
  credits: BenefitSample<CodexCredits>
  referrals: BenefitSample<ReferralCapacity>
}
export type BenefitChannel = 'quota' | 'referrals'
export type QuotaBenefits = Pick<AccountBenefits, 'resetCredits' | 'credits'>
export type ReferralBenefits = Pick<AccountBenefits, 'referrals'>

/** Snapshot counts without expiration details cannot be aged safely. Live counts can. */
export function availableResetCredits(sample: BenefitSample<ResetCredits>, now: number): number | null {
  const value = sample.data
  if (!value) return null
  if (!sample.updatedAt && value.availableCount > value.expiresAt.length) return null
  const expired = value.expiresAt.filter(time => Date.parse(time) <= now).length
  return Math.max(0, value.availableCount - expired)
}

export function formatCredits(credits: CodexCredits | null | undefined): string {
  if (!credits) return '—'
  if (credits.unlimited) return '不限'
  if (!credits.hasCredits) return '0'
  if (credits.balance === null) return '—'
  const [whole, fraction] = new MoneyDecimal(credits.balance).toFixed().split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '')
}

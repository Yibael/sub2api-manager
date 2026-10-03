import { z } from 'zod'
import { MoneyDecimal, normalizeMoney } from './money'

/** Multipliers are ratios, not amounts: never round them to cents. */
export function normalizeMultiplier(value: unknown): string | null {
  const normalized = normalizeMoney(value)
  if (normalized === null) return null
  const amount = new MoneyDecimal(normalized), number = amount.toNumber()
  // The upstream accepts a JSON number (float64). Reject values that would
  // silently change on conversion, including underflow and excessive precision.
  return number > 0 && Number.isFinite(number) && amount.eq(new MoneyDecimal(number)) ? normalized : null
}

export function formatMultiplier(value: string | null) {
  return value === null ? '—' : `${new MoneyDecimal(value).toString()}×`
}

export const multiplierInputError = '倍率须大于 0，最多 4 位小数，且不超过 999999.9999'
export function normalizeWritableMultiplier(value: unknown): string | null {
  const normalized = normalizeMultiplier(value)
  if (normalized === null) return null
  const amount = new MoneyDecimal(normalized)
  // The checked upstream stores group rates as DECIMAL(10,4). Reject values
  // that storage would round, especially small positive rates rounding to zero.
  return amount.decimalPlaces() <= 4 && amount.lte('999999.9999') ? normalized : null
}

export const groupRateRequestSchema = z.object({
  rateMultiplier: z.string().trim().min(1).max(100).refine(value => normalizeWritableMultiplier(value) !== null, multiplierInputError).transform(value => normalizeWritableMultiplier(value)!),
}).strict()

export interface Group {
  id: number; name: string; description: string; platform: string; status: string;
  rateMultiplier: string | null; subscriptionType: string; exclusive: boolean;
  accountCount: number | null; imageRateIndependent: boolean; updatedAt: string | null;
}
export interface GroupRatePreview {
  token: string; group: Group; rateMultiplier: string; expiresAt: number;
}

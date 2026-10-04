import { z } from 'zod'
import { MoneyDecimal } from './money'

export interface AutoResetConfig { enabled: boolean; threshold5h: number; threshold7d: number }
export interface AutoResetPreview {
  token: string; account: { id: number; name: string }; current: AutoResetConfig; enabled: boolean; expiresAt: number;
}
export const autoResetRequestSchema = z.object({ enabled: z.boolean() }).strict()
export function formatResetThreshold(value: number) { return `${new MoneyDecimal(value).times(100).toString()}%` }

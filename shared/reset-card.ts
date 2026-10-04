import { z } from 'zod'
import type { Account, Sample, Usage } from './domain'
import type { QuotaBenefits } from './benefits'
import type { AutoResetConfig } from './auto-reset'

export type ResetCardState = 'executing' | 'success' | 'partial' | 'uncertain' | 'rejected' | 'reviewed'
export interface ResetCardOperation {
  id: string; accountId: number; state: ResetCardState; startedAt: number; finishedAt: number | null;
  message: string; windowsReset: number | null;
}
export interface ResetCardPreview {
  token: string; operationId: string; expiresAt: number; account: { id: number; name: string };
  availableCount: number; autoReset: AutoResetConfig; quota: Sample<Usage>; benefits: QuotaBenefits;
}
export interface ResetCardResult {
  operation: ResetCardOperation; account: Account | null; quota: Sample<Usage> | null; benefits: QuotaBenefits | null;
}
export const resetCardReviewSchema = z.object({ operationId: z.string().regex(/^[a-f0-9]{32}$/) }).strict()

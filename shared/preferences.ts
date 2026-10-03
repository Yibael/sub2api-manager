import { z } from 'zod'
import { defaultIntervals, intervalsSchema, subscriptionSchema, timezoneSchema } from './domain'

const currency = z.string().trim().min(1).max(12).refine(value => !/[\r\n\t]/.test(value))
export const workspacePreferencesSchema = z.object({
  pins: z.array(z.number().int().positive()).max(100).transform(ids => [...new Set(ids)]),
  subscriptions: z.array(subscriptionSchema).max(100).refine(items => new Set(items.map(item => item.accountId)).size === items.length, '订阅账号不能重复'),
  includeAdmin: z.boolean(), timeZone: timezoneSchema, actualCurrency: currency, costCurrency: currency,
  intervals: intervalsSchema,
  requireEntryVerification: z.boolean().default(true),
})
export const workspacePreferencesPatchSchema = workspacePreferencesSchema.partial().extend({ requireEntryVerification: z.boolean().optional() })
export const localPreferencesSchema = z.object({ hideAmounts: z.boolean(), theme: z.enum(['light', 'dark', 'system']) })
export const preferencesSchema = workspacePreferencesSchema.omit({ intervals: true }).extend(localPreferencesSchema.shape)
export type WorkspacePreferences = z.infer<typeof workspacePreferencesSchema>
export type WorkspacePreferencesInput = z.input<typeof workspacePreferencesSchema>
export type Preferences = z.infer<typeof preferencesSchema>
export interface WorkspaceSnapshot { revision: number; initialized: boolean; preferences: WorkspacePreferences }
export interface PasskeySummary { id: string; name: string; rpId: string; createdAt: number; lastUsedAt: number | null }
export function defaultWorkspacePreferences(timeZone = 'Asia/Shanghai'): WorkspacePreferences {
  return { pins: [], subscriptions: [], includeAdmin: true, timeZone, actualCurrency: '$', costCurrency: '$', intervals: { ...defaultIntervals }, requireEntryVerification: true }
}

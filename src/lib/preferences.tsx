import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { z } from 'zod'
import { subscriptionSchema, timezoneSchema, type PublicConfig } from '../../shared/domain'
import { toast } from 'sonner'

const currency = z.string().trim().min(1).max(12).refine(v => !/[\r\n\t]/.test(v))
export const preferencesSchema = z.object({
  pins: z.array(z.number().int().positive()).max(100).transform(ids => [...new Set(ids)]),
  subscriptions: z.array(subscriptionSchema).max(100).refine(items => new Set(items.map(item => item.accountId)).size === items.length, '订阅账号不能重复'), includeAdmin: z.boolean(), timeZone: timezoneSchema,
  actualCurrency: currency, costCurrency: currency, hideAmounts: z.boolean(), theme: z.enum(['light', 'dark', 'system']),
})
export type Preferences = z.infer<typeof preferencesSchema>
const Context = createContext<{ preferences: Preferences; update: (change: Partial<Preferences>) => void; config: PublicConfig } | null>(null)
export function PreferencesProvider({ config, children }: { config: PublicConfig; children: ReactNode }) {
  const key = `sub2api-manager:v1:${config.instanceId}`
  const [preferences, setPreferences] = useState<Preferences>(() => {
    const fallback: Preferences = { pins: config.demo ? [1, 2, 4] : [], subscriptions: config.demo ? [{ accountId: 1, price: 20, renewalDay: 15 }, { accountId: 2, price: 20, renewalDay: 8 }] : [],
      includeAdmin: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, actualCurrency: '$', costCurrency: '$', hideAmounts: false, theme: 'system' }
    try { return preferencesSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null')) } catch { return fallback }
  })
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key && event.newValue) try { setPreferences(preferencesSchema.parse(JSON.parse(event.newValue))) } catch { /* Ignore invalid external changes. */ }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [key])
  function update(change: Partial<Preferences>) {
    setPreferences(previous => {
      const next = preferencesSchema.parse({ ...previous, ...change })
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { toast.error('本地存储不可用，本次设置仅在当前会话保留') }
      return next
    })
  }
  return <Context.Provider value={{ config, preferences, update }}><ThemeProvider attribute="class" forcedTheme={preferences.theme === 'system' ? undefined : preferences.theme} defaultTheme="system" enableSystem>{children}</ThemeProvider></Context.Provider>
}
export function useWorkspace() {
  const value = useContext(Context)
  if (!value) throw new Error('Workspace is unavailable')
  return value
}

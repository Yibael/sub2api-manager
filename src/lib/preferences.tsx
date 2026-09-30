import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { preferencesSchema, localPreferencesSchema, workspacePreferencesSchema, type Preferences, type WorkspacePreferences, type WorkspaceSnapshot } from '../../shared/preferences'
import type { PublicConfig } from '../../shared/domain'
import { api, ApiError, queryClient } from './api'
import { refreshDelay } from './completion-query'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export { preferencesSchema }
export type { Preferences }
type Change = Partial<Preferences> & { intervals?: WorkspacePreferences['intervals'] }
const Context = createContext<{ preferences: Preferences; config: PublicConfig; update: (change: Change, revision?: number) => Promise<boolean>; revision: number; getRevision: () => number; getPreferences: () => WorkspacePreferences; isSaving: boolean; legacy: Preferences | null; migrationPending: boolean } | null>(null)
export function PreferencesProvider({ config, children }: { config: PublicConfig; children: ReactNode }) {
  const localKey = `sub2api-manager:ui:${config.instanceId}`
  const [bootstrap] = useState(() => {
    let legacy: Preferences | null = null
    try {
      for (const id of [config.instanceId, ...(config.legacyInstanceIds ?? [])]) {
        const raw = localStorage.getItem(`sub2api-manager:v1:${id}`)
        if (raw) { legacy = preferencesSchema.parse(JSON.parse(raw)); break }
      }
    } catch { /* Invalid legacy settings do not block startup. */ }
    try {
      const raw = localStorage.getItem(localKey)
      return { legacy, local: localPreferencesSchema.parse(raw ? JSON.parse(raw) : legacy ?? { hideAmounts: false, theme: 'system' }) }
    } catch { return { legacy, local: { hideAmounts: false, theme: 'system' as const } } }
  })
  const [local, setLocal] = useState(bootstrap.local)
  const [saving, setSaving] = useState(0), [visible, setVisible] = useState(document.visibilityState === 'visible')
  const key = ['workspace', config.instanceId]
  const workspace = useQuery<WorkspaceSnapshot>({ queryKey: key, queryFn: ({ signal }) => api('/workspace', undefined, signal), staleTime: 0, retry: false,
    structuralSharing: (previous, next) => previous && (previous as WorkspaceSnapshot).revision >= (next as WorkspaceSnapshot).revision ? previous : next })
  const { refetch, fetchStatus, dataUpdatedAt, errorUpdatedAt } = workspace
  const current = () => queryClient.getQueryData<WorkspaceSnapshot>(key)
  useEffect(() => {
    const change = () => {
      const active = document.visibilityState === 'visible'
      setVisible(active)
      if (active) void refetch()
    }
    const online = () => { void refetch() }
    const storage = (event: StorageEvent) => {
      if (event.key === localKey && event.newValue) try { setLocal(localPreferencesSchema.parse(JSON.parse(event.newValue))) } catch { /* Ignore malformed local preferences. */ }
    }
    document.addEventListener('visibilitychange', change); window.addEventListener('online', online); window.addEventListener('storage', storage)
    return () => { document.removeEventListener('visibilitychange', change); window.removeEventListener('online', online); window.removeEventListener('storage', storage) }
  }, [localKey, refetch])
  useEffect(() => {
    if (!visible || saving || fetchStatus !== 'idle' || !navigator.onLine) return
    const completedAt = Math.max(dataUpdatedAt, errorUpdatedAt)
    if (!completedAt) return
    const timer = window.setTimeout(() => { void refetch() }, refreshDelay(completedAt, 5))
    return () => window.clearTimeout(timer)
  }, [visible, saving, fetchStatus, dataUpdatedAt, errorUpdatedAt, refetch])
  async function update(change: Change, revision = workspace.data?.revision): Promise<boolean> {
    const shared: Partial<WorkspacePreferences> = {}
    for (const field of Object.keys(workspacePreferencesSchema.shape)) if (field in change) Object.assign(shared, { [field]: change[field as keyof Change] })
    const needsServer = Object.keys(shared).length > 0 || (!Object.keys(change).length && !current()?.initialized)
    setSaving(value => value + 1)
    try {
      if (needsServer) {
        if (!current()) throw new Error('正在读取配置，请稍后重试')
        const next = await api<WorkspaceSnapshot>('/workspace', { revision, preferences: shared }, undefined, 'PATCH')
        queryClient.setQueryData<WorkspaceSnapshot>(key, previous => previous && previous.revision > next.revision ? previous : next)
      }
      if ('theme' in change || 'hideAmounts' in change) {
        const next = localPreferencesSchema.parse({ ...local, ...change })
        localStorage.setItem(localKey, JSON.stringify(next)); setLocal(next)
      }
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refetch()
      toast.error((error as Error).message)
      return false
    } finally { setSaving(value => value - 1) }
  }
  if (!workspace.data) return <main className="loading-screen">{workspace.error ? <Alert variant="destructive"><AlertTitle>无法读取配置</AlertTitle><AlertDescription>{workspace.error.message}<Button variant="outline" onClick={() => void refetch()}>重试</Button></AlertDescription></Alert> : <Skeleton className="h-40 w-full max-w-sm" />}</main>
  const preferences: Preferences = { ...workspace.data.preferences, ...local }
  const sharedConfig = { ...config, intervals: workspace.data.preferences.intervals }
  return <Context.Provider value={{ preferences, config: sharedConfig, update, revision: workspace.data.revision, getRevision: () => current()?.revision ?? workspace.data!.revision, getPreferences: () => current()?.preferences ?? workspace.data!.preferences, isSaving: saving > 0, legacy: bootstrap.legacy, migrationPending: !workspace.data.initialized && !!bootstrap.legacy }}><ThemeProvider attribute="class" forcedTheme={local.theme === 'system' ? undefined : local.theme} defaultTheme="system" enableSystem>{children}</ThemeProvider></Context.Provider>
}
export function useWorkspace() {
  const value = useContext(Context)
  if (!value) throw new Error('Workspace is unavailable')
  return value
}

import type { Sample } from '../shared/domain'
import { UpstreamError } from './upstream'

interface Entry<T> { sample: Sample<T>; settledAt: number | null; intervalMs: number; retryAt: number; failures: number; pending?: Promise<Sample<T>>; pendingForce?: boolean }

/** Demand-only cache. No timers, refresh jobs, or detached retries. */
export class DemandCache<T> {
  private entries = new Map<string, Entry<T>>()
  constructor(private readonly maxEntries = 5000, private readonly now = () => Date.now()) {}

  async get(key: string, intervalMs: number, load: () => Promise<T>, force = false): Promise<Sample<T>> {
    const result = await this.getMany([key], intervalMs, async () => {
      try { return new Map([[key, await load()]]) } catch (error) { return new Map([[key, safeError(error)]]) }
    }, force)
    return result[key]
  }

  async getMany(keys: string[], intervalMs: number, load: (missing: string[]) => Promise<Map<string, T | Error>>, force = false): Promise<Record<string, Sample<T>>> {
    const unique = [...new Set(keys)]
    // A force request must not reuse an ordinary request that may hit upstream caches.
    const ordinary = force ? unique.flatMap(key => {
      const entry = this.entries.get(key)
      return entry?.pending && !entry.pendingForce ? [entry.pending] : []
    }) : []
    if (ordinary.length) {
      await Promise.all(ordinary)
      return this.getMany(unique, intervalMs, load, force)
    }
    // Check capacity before reserving any promises, so rejection cannot strand waiters.
    this.trim(unique.filter(key => !this.entries.has(key)).length, new Set(unique))
    const waiting = new Map<string, Promise<Sample<T>>>()
    const missing = new Map<string, { entry: Entry<T>; resolve: (sample: Sample<T>) => void }>()
    for (const key of unique) {
      let entry = this.entries.get(key)
      if (!entry) {
        entry = { sample: { data: null, updatedAt: null, error: null }, settledAt: null, intervalMs, retryAt: 0, failures: 0 }
        this.entries.set(key, entry)
      }
      entry.intervalMs = intervalMs
      if (entry.pending) { waiting.set(key, entry.pending); continue }
      const cooling = entry.settledAt !== null && this.now() < entry.settledAt + intervalMs
      if ((!force && cooling) || this.now() < entry.retryAt) { waiting.set(key, Promise.resolve(entry.sample)); continue }
      let resolve!: (sample: Sample<T>) => void
      entry.pending = new Promise(r => { resolve = r })
      entry.pendingForce = force
      waiting.set(key, entry.pending)
      missing.set(key, { entry, resolve })
    }
    // Every requested key is reserved synchronously before the first await.
    if (missing.size) {
      let values: Map<string, T | Error>
      try { values = await load([...missing.keys()]) } catch (error) {
        values = new Map([...missing.keys()].map(key => [key, safeError(error)]))
      }
      for (const [key, { entry, resolve }] of missing) {
        const value = values.get(key) ?? new Error('响应缺少所需数据')
        const now = this.now()
        entry.settledAt = now
        if (value instanceof Error) {
          entry.failures++
          entry.retryAt = Math.max(
            now + Math.min(600_000, intervalMs * 2 ** Math.min(entry.failures - 1, 8)),
            value instanceof UpstreamError ? value.retryAt ?? 0 : 0,
          )
          entry.sample = { ...entry.sample, error: value.message }
        } else {
          entry.failures = 0
          entry.retryAt = 0
          entry.sample = { data: value, updatedAt: now, error: null }
        }
        entry.pending = undefined
        entry.pendingForce = undefined
        resolve(entry.sample)
      }
    }
    return Object.fromEntries(await Promise.all([...waiting].map(async ([key, promise]) => [key, await promise])))
  }

  private trim(incoming: number, requested: Set<string>) {
    if (this.entries.size + incoming <= this.maxEntries) return
    for (const [key, entry] of this.entries) {
      // Never evict in-flight work or an unexpired cooldown to make room.
      if (!requested.has(key) && !entry.pending && this.now() > Math.max(entry.retryAt, (entry.settledAt ?? 0) + Math.max(600_000, entry.intervalMs))) {
        this.entries.delete(key)
        if (this.entries.size + incoming <= this.maxEntries) break
      }
    }
    if (this.entries.size + incoming > this.maxEntries) throw new Error('查询范围过多，请稍后重试')
  }
}
export function safeError(error: unknown): Error {
  return error instanceof Error ? error : new Error('请求失败，请稍后重试')
}

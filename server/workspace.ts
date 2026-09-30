import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { workspacePreferencesSchema, defaultWorkspacePreferences, type WorkspacePreferences, type WorkspaceSnapshot, type PasskeySummary } from '../shared/preferences'
import { readSettings } from './settings'

const passkeySchema = z.object({
  id: z.string().min(1).max(2048), name: z.string().trim().min(1).max(80), rpId: z.string().min(1),
  publicKey: z.string().min(1), counter: z.number().int().nonnegative(), transports: z.array(z.string()).max(10),
  deviceType: z.enum(['singleDevice', 'multiDevice']), backedUp: z.boolean(),
  createdAt: z.number(), lastUsedAt: z.number().nullable(),
})
const stateSchema = z.object({
  version: z.literal(1), id: z.string().min(1), userHandle: z.string().min(1), legacyInstanceIds: z.array(z.string()),
  revision: z.number().int().nonnegative(), initialized: z.boolean(), preferences: workspacePreferencesSchema,
  passkeys: z.array(passkeySchema).max(20),
})
export type StoredPasskey = z.infer<typeof passkeySchema>
export class WorkspaceConflict extends Error { constructor() { super('配置已被其他设备修改，请检查最新设置后重试') } }
export class WorkspaceStore {
  private tail: Promise<unknown> = Promise.resolve()
  private constructor(private state: z.infer<typeof stateSchema>, private path?: string) {}
  static memory(id = 'test-workspace', timeZone = 'UTC') {
    return new WorkspaceStore({ version: 1, id, userHandle: randomBytes(32).toString('base64url'), legacyInstanceIds: [], revision: 0, initialized: false, preferences: defaultWorkspacePreferences(timeZone), passkeys: [] })
  }
  static async open(path: string, timeZone: string, legacyId: string) {
    try { return new WorkspaceStore(stateSchema.parse(JSON.parse(await readFile(path, 'utf8'))), path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('工作空间文件无效，请检查 DATA_DIR/workspace.json')
    }
    const store = WorkspaceStore.memory(randomBytes(20).toString('hex'), timeZone)
    store.path = path
    store.state.legacyInstanceIds = [legacyId]
    store.state.preferences.intervals = await readSettings(`${dirname(path)}/intervals.json`)
    await store.persist(store.state)
    return store
  }
  get id() { return this.state.id }
  get userHandle() { return this.state.userHandle }
  get legacyInstanceIds() { return [...this.state.legacyInstanceIds] }
  snapshot(): WorkspaceSnapshot { return structuredClone({ revision: this.state.revision, initialized: this.state.initialized, preferences: this.state.preferences }) }
  credentials() { return structuredClone(this.state.passkeys) }
  summaries(): PasskeySummary[] { return this.state.passkeys.map(({ id, name, rpId, createdAt, lastUsedAt }) => ({ id, name, rpId, createdAt, lastUsedAt })) }
  private async persist(state: z.infer<typeof stateSchema>) {
    if (!this.path) return
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path)
    } catch (error) { await unlink(temporary).catch(() => {}); throw error }
  }
  private mutate<T>(change: (state: z.infer<typeof stateSchema>) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.state)
      const result = change(next)
      const checked = stateSchema.parse(next)
      await this.persist(checked)
      this.state = checked
      return result
    })
    this.tail = operation.catch(() => {})
    return operation
  }
  update(revision: number, patch: Partial<WorkspacePreferences>) {
    return this.mutate(state => {
      if (state.revision !== revision) throw new WorkspaceConflict()
      state.preferences = workspacePreferencesSchema.parse({ ...state.preferences, ...patch })
      state.initialized = true
      state.revision++
      return structuredClone({ revision: state.revision, initialized: state.initialized, preferences: state.preferences })
    })
  }
  addPasskey(value: StoredPasskey) {
    return this.mutate(state => {
      if (state.passkeys.length >= 20) throw new Error('最多添加 20 个 Passkey')
      if (state.passkeys.some(key => key.id === value.id)) throw new Error('此 Passkey 已经添加')
      state.passkeys.push(passkeySchema.parse(value))
    })
  }
  recordAuthentication(id: string, previousCounter: number, counter: number, backedUp: boolean) {
    return this.mutate(state => {
      const key = state.passkeys.find(value => value.id === id)
      if (!key || key.counter !== previousCounter) throw new Error('Passkey 已变更，请重新验证')
      key.counter = counter; key.backedUp = backedUp; key.lastUsedAt = Date.now()
    })
  }
  renamePasskey(id: string, name: string) {
    return this.mutate(state => {
      const key = state.passkeys.find(value => value.id === id)
      if (!key) throw new Error('Passkey 不存在')
      key.name = passkeySchema.shape.name.parse(name)
    })
  }
  removePasskey(id: string) { return this.mutate(state => { state.passkeys = state.passkeys.filter(key => key.id !== id) }) }
}

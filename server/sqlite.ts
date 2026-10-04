import { Database } from 'bun:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { ManagerPersistence, type BenefitKind, type StoredBenefit } from './persistence'
import type { ResetCardOperation } from '../shared/reset-card'

/** Production is a single Bun process. WAL also protects reads across connections. */
export class SQLitePersistence extends ManagerPersistence {
  private db: Database
  constructor(path: string, private scope: string) {
    super()
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new Database(path, { create: true, strict: true })
    if (path !== ':memory:') chmodSync(path, 0o600)
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    const version = (this.db.query('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version > 1) { this.db.close(); throw new Error('Manager 数据库版本过新，请使用对应版本的应用') }
    if (version === 0) this.db.transaction(() => {
      this.db.exec(`CREATE TABLE benefit_snapshots (
        scope TEXT NOT NULL, account_id INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(scope, account_id, kind));
        CREATE TABLE reset_card_operations (
          scope TEXT NOT NULL, id TEXT NOT NULL, account_id INTEGER NOT NULL, state TEXT NOT NULL,
          started_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope, id));
        CREATE UNIQUE INDEX one_unresolved_reset_per_account ON reset_card_operations(scope, account_id)
          WHERE state IN ('executing', 'uncertain');
        PRAGMA user_version = 1;`)
    })()
    // A request may have spent the card before a crash. Never automatically resend.
    const interrupted = this.db.query("SELECT payload FROM reset_card_operations WHERE scope = ? AND state = 'executing'").all(scope) as { payload: string }[]
    this.db.transaction(() => {
      for (const row of interrupted) this.updateOperation({ ...JSON.parse(row.payload), state: 'uncertain', finishedAt: Date.now(),
        message: '服务重启前的用卡结果未能确认，请查询额度并核对后再操作。' })
    })()
  }
  close() { this.db.close() }
  transaction<T>(work: () => T): T { return this.db.transaction(work)() }
  benefit(id: number, kind: BenefitKind): StoredBenefit | null {
    const row = this.db.query('SELECT payload FROM benefit_snapshots WHERE scope = ? AND account_id = ? AND kind = ?').get(this.scope, id, kind) as { payload: string } | null
    return row ? JSON.parse(row.payload) : null
  }
  putBenefit(id: number, kind: BenefitKind, value: StoredBenefit) {
    this.db.query('INSERT INTO benefit_snapshots VALUES (?, ?, ?, ?) ON CONFLICT(scope, account_id, kind) DO UPDATE SET payload = excluded.payload')
      .run(this.scope, id, kind, JSON.stringify(value))
  }
  operation(id: string): ResetCardOperation | null {
    const row = this.db.query('SELECT payload FROM reset_card_operations WHERE scope = ? AND id = ?').get(this.scope, id) as { payload: string } | null
    return row ? JSON.parse(row.payload) : null
  }
  latestOperation(accountId: number): ResetCardOperation | null {
    const row = this.db.query('SELECT payload FROM reset_card_operations WHERE scope = ? AND account_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(this.scope, accountId) as { payload: string } | null
    return row ? JSON.parse(row.payload) : null
  }
  claimOperation(value: ResetCardOperation): boolean {
    const result = this.db.query('INSERT OR IGNORE INTO reset_card_operations VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.scope, value.id, value.accountId, value.state, value.startedAt, JSON.stringify(value))
    return result.changes === 1
  }
  updateOperation(value: ResetCardOperation) {
    this.db.query('UPDATE reset_card_operations SET state = ?, payload = ? WHERE scope = ? AND id = ?')
      .run(value.state, JSON.stringify(value), this.scope, value.id)
  }
}

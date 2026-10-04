import { createHash } from 'node:crypto'
import type { AccountBenefits, BenefitSample } from '../shared/benefits'
import type { ResetCardOperation } from '../shared/reset-card'

export type BenefitKind = keyof AccountBenefits
export interface StoredBenefit {
  sample: BenefitSample<unknown>; fingerprint: string; source: 'sub2api' | 'query'; observedAt: number; cachePersisted: boolean | null;
}
export const benefitFingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Only normalized, allowlisted data enters this store. No raw account/extra payloads. */
export abstract class ManagerPersistence {
  transaction<T>(work: () => T): T { return work() }
  abstract benefit(id: number, kind: BenefitKind): StoredBenefit | null
  abstract putBenefit(id: number, kind: BenefitKind, value: StoredBenefit): void
  abstract operation(id: string): ResetCardOperation | null
  abstract latestOperation(accountId: number): ResetCardOperation | null
  abstract claimOperation(value: ResetCardOperation): boolean
  abstract updateOperation(value: ResetCardOperation): void

  recordBenefit<T>(id: number, kind: BenefitKind, sample: BenefitSample<T>, source: StoredBenefit['source'], observedAt: number, cachePersisted?: boolean | null): BenefitSample<T> {
    const previous = this.benefit(id, kind), fingerprint = benefitFingerprint(sample.data)
    if (previous && observedAt < previous.observedAt) return { ...previous.sample, error: sample.error } as BenefitSample<T>
    const same = previous?.fingerprint === fingerprint
    const updatedAt = sample.updatedAt ?? (sample.data !== null && same ? previous!.sample.updatedAt : null)
    const result = { ...sample, updatedAt }
    this.putBenefit(id, kind, { sample: { ...result, error: null }, fingerprint,
      source: source === 'sub2api' && same && sample.updatedAt === null ? previous!.source : source, observedAt,
      cachePersisted: cachePersisted !== undefined ? cachePersisted : source === 'sub2api' && sample.data !== null ? true : same ? previous!.cachePersisted : null })
    return result
  }
}

export class MemoryPersistence extends ManagerPersistence {
  private benefits = new Map<string, StoredBenefit>()
  private operations = new Map<string, ResetCardOperation>()
  benefit(id: number, kind: BenefitKind) { return this.benefits.get(`${id}:${kind}`) ?? null }
  putBenefit(id: number, kind: BenefitKind, value: StoredBenefit) { this.benefits.set(`${id}:${kind}`, structuredClone(value)) }
  operation(id: string) { return this.operations.get(id) ?? null }
  latestOperation(accountId: number) { return [...this.operations.values()].filter(v => v.accountId === accountId).at(-1) ?? null }
  claimOperation(value: ResetCardOperation) {
    if (this.operations.has(value.id) || [...this.operations.values()].some(v => v.accountId === value.accountId && ['executing', 'uncertain'].includes(v.state))) return false
    this.operations.set(value.id, structuredClone(value)); return true
  }
  updateOperation(value: ResetCardOperation) { this.operations.set(value.id, structuredClone(value)) }
}

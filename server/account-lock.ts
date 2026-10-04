/** Both card consumption and auto-reset setting writes use the same account lock. */
export class AccountWriteLock {
  private busy = new Set<number>()
  async run<T>(id: number, work: () => Promise<T>, conflict: () => Error): Promise<T> {
    if (this.busy.has(id)) throw conflict()
    this.busy.add(id)
    try { return await work() } finally { this.busy.delete(id) }
  }
}

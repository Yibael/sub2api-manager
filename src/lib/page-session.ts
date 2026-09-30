/** Per-document unlock state. Never written to browser storage. */
export class PageSession {
  private value: string | null = null
  private epochValue = 0
  private revision = 0
  private flow: number | null = null
  private nextFlow = 0
  private suspendedValue = false
  private listeners = new Set<() => void>()
  get token() { return this.value }
  get epoch() { return this.epochValue }
  get unlocked() { return !!this.value && !this.suspendedValue }
  get verifying() { return this.flow !== null }
  get suspended() { return this.suspendedValue }
  getSnapshot = () => this.revision
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private notify() { this.revision++; for (const listener of this.listeners) listener() }
  assertCurrent(epoch: number) {
    if (epoch !== this.epochValue) throw new DOMException('页面已锁定，请重新验证', 'AbortError')
  }
  activate(token: string, epoch: number) {
    this.assertCurrent(epoch)
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('验证响应无效，请重试')
    this.value = token; this.epochValue++; this.notify()
  }
  clear() {
    const previous = this.value
    this.value = null; this.flow = null; this.suspendedValue = false
    this.epochValue++; this.notify()
    return previous
  }
  suspend() { this.suspendedValue = true; this.notify() }
  beginVerification() {
    if (this.verifying) throw new Error('请先完成当前 Passkey 验证')
    const id = ++this.nextFlow
    this.flow = id; this.notify()
    return { epoch: this.epochValue, finish: (verified: boolean, visible: boolean) => {
      if (this.flow !== id) return false
      this.flow = null
      // A system credential sheet may hide the page. Only a successful user
      // verification can release that suspension; cancellation locks the page.
      const lock = !visible || (this.suspendedValue && !verified)
      if (!lock) this.suspendedValue = false
      this.notify()
      return lock
    } }
  }
}
export const pageSession = new PageSession()

export function bindPageLifecycle(session: PageSession, document: EventTarget & { visibilityState: string }, window: EventTarget, lock: () => void, suspend = () => session.suspend()) {
  const visibility = () => {
    if (document.visibilityState !== 'hidden') return
    if (session.verifying) suspend(); else lock()
  }
  const show = (event: Event) => { if ((event as PageTransitionEvent).persisted) lock() }
  document.addEventListener('visibilitychange', visibility)
  document.addEventListener('freeze', lock)
  window.addEventListener('pagehide', lock)
  window.addEventListener('pageshow', show)
  return () => {
    document.removeEventListener('visibilitychange', visibility)
    document.removeEventListener('freeze', lock)
    window.removeEventListener('pagehide', lock)
    window.removeEventListener('pageshow', show)
  }
}

/** One automatic prompt per foreground visit, preserved across effect remounts. */
export class AutomaticPasskeyPrompt {
  private attempted = false
  bind(document: EventTarget & { visibilityState: string }, ready: () => boolean, verifying: () => boolean, attempt: () => void) {
    const start = () => {
      if (this.attempted || document.visibilityState !== 'visible' || !ready()) return
      this.attempted = true
      attempt()
    }
    const visibility = () => {
      // A system credential sheet can hide the document. Its dismissal must
      // not start another prompt; a later normal foreground visit may do so.
      if (document.visibilityState === 'hidden' && !verifying()) this.attempted = false
      if (document.visibilityState === 'visible') start()
    }
    document.addEventListener('visibilitychange', visibility)
    start()
    return () => document.removeEventListener('visibilitychange', visibility)
  }
}

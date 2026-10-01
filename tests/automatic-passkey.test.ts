import { describe, expect, it, vi } from 'vitest'
import { AutomaticPasskeyPrompt } from '../src/lib/automatic-passkey'

function setup(visible = true) {
  const document = Object.assign(new EventTarget(), { visibilityState: visible ? 'visible' : 'hidden' })
  const prompt = new AutomaticPasskeyPrompt(), attempt = vi.fn()
  let ready = true, verifying = false
  const bind = () => prompt.bind(document, () => ready && !verifying, () => verifying, attempt)
  const visibility = (value: string) => { document.visibilityState = value; document.dispatchEvent(new Event('visibilitychange')) }
  return { attempt, bind, visibility, ready: (value: boolean) => { ready = value }, verifying: (value: boolean) => { verifying = value } }
}
describe('automatic Passkey login', () => {
  it('prompts once on entry, including effect reconnects, and leaves cancellation to manual retry', () => {
    const page = setup(), cleanup = page.bind()
    expect(page.attempt).toHaveBeenCalledOnce()
    cleanup(); const reconnect = page.bind()
    page.visibility('visible')
    expect(page.attempt).toHaveBeenCalledOnce()
    reconnect()
  })
  it('waits for a visible page and never starts during another login', () => {
    const page = setup(false)
    page.ready(false); const cleanup = page.bind()
    page.visibility('visible')
    expect(page.attempt).not.toHaveBeenCalled()
    page.ready(true); page.visibility('visible')
    expect(page.attempt).toHaveBeenCalledOnce()
    cleanup()
  })
  it('does not reopen a cancelled system sheet but retries after a later normal foreground visit', () => {
    const page = setup(), cleanup = page.bind()
    page.verifying(true); page.visibility('hidden'); page.visibility('visible')
    page.verifying(false); page.visibility('visible')
    expect(page.attempt).toHaveBeenCalledOnce()
    page.visibility('hidden'); page.visibility('visible'); page.visibility('visible')
    expect(page.attempt).toHaveBeenCalledTimes(2)
    cleanup()
  })
  it('ignores lifecycle events once the login screen is gone', () => {
    const page = setup(false), cleanup = page.bind()
    cleanup(); page.visibility('visible')
    expect(page.attempt).not.toHaveBeenCalled()
  })
})

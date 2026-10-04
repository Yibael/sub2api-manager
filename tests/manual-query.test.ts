import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusManager, onlineManager, QueryClient, QueryObserver } from '@tanstack/react-query'
import { manualQueryOptions } from '../src/lib/manual-query'
import { forceQuery } from '../src/lib/completion-query'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T00:00:00Z')) })
afterEach(() => { focusManager.setFocused(undefined); onlineManager.setOnline(true); vi.useRealTimers() })

describe('manual account benefit reads', () => {
  it('reads once explicitly and never repeats on timers, focus, reconnect, invalidation or observer remount', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: true, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always' } } })
    client.mount()
    const key = ['benefits', 'workspace', 1, 'quota'], load = vi.fn().mockResolvedValue('snapshot')
    const observer = new QueryObserver(client, manualQueryOptions(key, load))
    let unsubscribe = observer.subscribe(() => {})
    expect(load).not.toHaveBeenCalled()
    await observer.refetch({ cancelRefetch: false })
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(120_000)
    focusManager.setFocused(false); focusManager.setFocused(true)
    onlineManager.setOnline(false); onlineManager.setOnline(true)
    await client.invalidateQueries({ queryKey: ['benefits'] })
    await client.refetchQueries({ queryKey: ['benefits'] })
    unsubscribe(); unsubscribe = observer.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    expect(observer.getCurrentResult().data).toBe('snapshot')
    await observer.refetch({ cancelRefetch: false })
    expect(load).toHaveBeenCalledTimes(2)
    unsubscribe(); client.unmount(); client.clear()
  })
  it('forces only the selected channel and keeps the manual result after invalidation', async () => {
    const client = new QueryClient(), quotaKey = ['benefits', 'workspace', 1, 'quota'], referralKey = ['benefits', 'workspace', 1, 'referrals']
    const quota = vi.fn().mockResolvedValue('quota snapshot'), referrals = vi.fn().mockResolvedValue('referral snapshot')
    const a = new QueryObserver(client, manualQueryOptions(quotaKey, quota)), b = new QueryObserver(client, manualQueryOptions(referralKey, referrals))
    const stopA = a.subscribe(() => {}), stopB = b.subscribe(() => {})
    await Promise.all([a.refetch(), b.refetch()])
    const force = vi.fn().mockResolvedValue('fresh quota')
    await Promise.all([forceQuery(client, quotaKey, force), forceQuery(client, quotaKey, force)])
    await client.invalidateQueries({ queryKey: ['benefits'] })
    expect(force).toHaveBeenCalledTimes(1)
    expect(quota).toHaveBeenCalledTimes(1); expect(referrals).toHaveBeenCalledTimes(1)
    expect(a.getCurrentResult().data).toBe('fresh quota')
    expect(b.getCurrentResult().data).toBe('referral snapshot')
    stopA(); stopB(); client.clear()
  })
  it('does not automatically retry a failed first read', async () => {
    const client = new QueryClient(), load = vi.fn().mockRejectedValue(new Error('读取失败'))
    const observer = new QueryObserver(client, manualQueryOptions(['benefits', 'workspace', 1, 'quota'], load))
    const stop = observer.subscribe(() => {})
    await observer.refetch()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(1)
    expect(observer.getCurrentResult().error?.message).toBe('读取失败')
    stop(); client.clear()
  })
})

interface RefreshChannel {
  enabled: boolean
  interval: number
  dataUpdatedAt: number
  errorUpdatedAt: number
  fetchStatus: 'fetching' | 'paused' | 'idle'
}

export function refreshCountdown(now: number, channels: RefreshChannel[]): number | null {
  const active = channels.filter(channel => channel.enabled)
  if (!active.length || active.some(channel => channel.fetchStatus !== 'idle')) return null
  const seconds = active.map(channel => {
    const completedAt = Math.max(channel.dataUpdatedAt, channel.errorUpdatedAt)
    if (!completedAt) return null
    return Math.min(channel.interval, Math.max(0, Math.ceil((completedAt + channel.interval * 1000 - now) / 1000)))
  })
  if (seconds.some(value => value === null)) return null
  return Math.min(...seconds as number[])
}

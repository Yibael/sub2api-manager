export function formatQuotaCountdown(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null
  const deadline = Date.parse(resetsAt)
  if (!Number.isFinite(deadline)) return null
  const remaining = Math.ceil((deadline - now) / 1000)
  if (remaining <= 0) return '等待额度更新'
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor(remaining % 86400 / 3600)
  const minutes = Math.floor(remaining % 3600 / 60)
  const seconds = remaining % 60
  const values = [days, hours, minutes, seconds]
  const units = ['d', 'h', 'm', 's']
  const firstUnit = values.findIndex(value => value > 0)
  const time = values.map((value, index) => `${value}${units[index]}`).slice(firstUnit).join(' ')
  return `${time} 后重置`
}

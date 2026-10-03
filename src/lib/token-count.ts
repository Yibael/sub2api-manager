const units = [{ divisor: 1e3, suffix: 'K' }, { divisor: 1e6, suffix: 'M' }, { divisor: 1e9, suffix: 'B' }]
const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export function formatTokenCount(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return '—'
  if (value < units[0].divisor) return formatter.format(value)
  let index = 0
  while (index < units.length - 1 && value >= units[index + 1].divisor) index++
  let amount = formatter.format(value / units[index].divisor)
  if (amount === '1,000' && index < units.length - 1) {
    index++
    amount = formatter.format(value / units[index].divisor)
  }
  return amount + units[index].suffix
}

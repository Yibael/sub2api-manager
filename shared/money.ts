import Decimal from 'decimal.js'

// Keep one calculation policy across the server and browser. Amounts cross JSON
// boundaries as decimal strings; rounding to cents belongs only to presentation.
export const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export type MoneyAmount = string
export type MoneyInput = MoneyAmount | number

export function normalizeMoney(value: unknown): MoneyAmount | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null
  try {
    const amount = new MoneyDecimal(typeof value === 'string' ? value.trim() : value)
    if (!amount.isFinite() || (amount.isNegative() && !amount.isZero()) || !Number.isFinite(amount.toNumber())) return null
    return amount.toString()
  } catch { return null }
}

export function sumMoney(values: Iterable<MoneyInput>): MoneyAmount {
  let total = new MoneyDecimal(0)
  for (const value of values) total = total.plus(value)
  return total.toString()
}

export function formatMoney(value: unknown): string | null {
  const amount = normalizeMoney(value)
  if (amount === null) return null
  const [whole, fraction] = new MoneyDecimal(amount).toFixed(2, MoneyDecimal.ROUND_HALF_UP).split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction
}

import { expect, it } from 'vitest'
import { formatTokenCount } from '../src/lib/token-count'

it.each([
  [0, '0'], [999, '999'], [1000, '1K'], [1234, '1.23K'],
  [640000, '640K'], [999994, '999.99K'], [999995, '1M'],
  [1000000, '1M'], [1420000, '1.42M'], [999995000, '1B'],
  [1000000000, '1B'], [1234567890, '1.23B'], [1000000000000, '1,000B'],
])('formats %s tokens as %s', (value, expected) => {
  expect(formatTokenCount(value as number)).toBe(expected)
})
it('keeps invalid token counts unknown', () => {
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(formatTokenCount(value)).toBe('—')
})

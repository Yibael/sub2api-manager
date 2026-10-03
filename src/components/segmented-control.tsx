import type { ReactNode } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export function SegmentedControl<Value extends string>({ options, value, onValueChange, className, size = 'sm', ...props }: {
  options: readonly { value: Value; label: ReactNode; disabled?: boolean }[]
  value: Value
  onValueChange: (value: Value) => void
  'aria-label': string
  className?: string
  size?: 'default' | 'sm' | 'lg'
  disabled?: boolean
}) {
  return <ToggleGroup type="single" variant="segmented" spacing={1} size={size} value={value} className={cn('w-full shrink-0 sm:w-fit', className)} onValueChange={next => {
    const selected = options.find(option => option.value === next)
    if (selected && selected.value !== value) onValueChange(selected.value)
  }} {...props}>
    {options.map(option => <ToggleGroupItem key={option.value} value={option.value} disabled={option.disabled} className="flex-1 sm:flex-none">{option.label}</ToggleGroupItem>)}
  </ToggleGroup>
}

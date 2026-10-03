import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { PageHeading } from '@/components/common'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function ResourcesHeading({ section, action }: { section: 'accounts' | 'groups'; action?: ReactNode }) {
  const navigate = useNavigate()
  return <>
    <PageHeading title="资源" action={action} />
    <ToggleGroup type="single" value={section} variant="segmented" spacing={1} aria-label="资源类型" className="w-full sm:w-fit" onValueChange={value => {
      if (value === 'accounts' || value === 'groups') void navigate({ to: value === 'groups' ? '/groups' : '/accounts', replace: true })
    }}>
      <ToggleGroupItem value="accounts" className="flex-1 sm:flex-none">账号</ToggleGroupItem>
      <ToggleGroupItem value="groups" className="flex-1 sm:flex-none">分组</ToggleGroupItem>
    </ToggleGroup>
  </>
}

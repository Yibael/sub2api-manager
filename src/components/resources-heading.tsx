import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { PageHeading } from '@/components/common'
import { SegmentedControl } from '@/components/segmented-control'

const sections = [{ value: 'accounts', label: '账号' }, { value: 'groups', label: '分组' }] as const

export function ResourcesHeading({ section, action }: { section: 'accounts' | 'groups'; action?: ReactNode }) {
  const navigate = useNavigate()
  return <>
    <PageHeading title="资源" action={action} />
    <SegmentedControl options={sections} value={section} aria-label="资源类型" onValueChange={value => {
      void navigate({ to: value === 'groups' ? '/groups' : '/accounts', replace: true })
    }} />
  </>
}

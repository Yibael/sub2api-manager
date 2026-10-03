import { useIsFetching } from '@tanstack/react-query'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { toast } from 'sonner'
import { RefreshButton } from '@/components/common'
import { StableRegion, DirectorySkeleton, GroupDirectorySkeleton } from '@/components/loading'
import { ResourcesHeading } from '@/components/resources-heading'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api, queryClient } from '@/lib/api'
import { forceQuery } from '@/lib/completion-query'
import { useWorkspace } from '@/lib/preferences'
import { cn } from '@/lib/utils'

export function ResourcesLayout() {
  const { config } = useWorkspace()
  const pathname = useRouterState({ select: state => state.location.pathname })
  const section = pathname === '/groups' ? 'groups' : 'accounts'
  const key = [section, config.instanceId]
  const busy = useIsFetching({ queryKey: key, exact: true }) > 0
  async function refresh() {
    if (busy) return
    try { await forceQuery(queryClient, key, signal => api(`/${section}?force=true`, undefined, signal)) }
    catch (error) { toast.error((error as Error).message) }
  }
  return <div className="page-stack">
    <ResourcesHeading section={section} action={<RefreshButton busy={busy} onClick={() => void refresh()} />} />
    <StableRegion phase={section}><Outlet /></StableRegion>
  </div>
}

export function ResourcesSkeleton() {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const groups = pathname === '/groups'
  const title = groups ? '分组目录' : '账号目录'
  return <div className="page-stack" role="status" aria-label={`正在读取${title}`}>
    <div className="account-toolbar"><Skeleton className="h-11 w-full max-w-[420px]" /><Skeleton className="h-11 w-48" /></div>
    <Card><CardHeader><CardTitle>{title}</CardTitle><Skeleton className="h-5 w-40" /></CardHeader><CardContent className={cn(!groups && 'account-list')}>{groups ? <GroupDirectorySkeleton /> : <DirectorySkeleton />}</CardContent></Card>
  </div>
}

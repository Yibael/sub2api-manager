import { Clock3, CircleHelp } from 'lucide-react'
import { useWorkspace } from '@/lib/preferences'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export function QueryTimeBadge({ updatedAt }: { updatedAt: number | null }) {
  const { preferences } = useWorkspace()
  const label = updatedAt === null ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { timeZone: preferences.timeZone,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(updatedAt)
  const description = updatedAt === null ? '当前缓存没有可信的查询时间。手动刷新后可记录时间。'
    : `查询于 ${new Intl.DateTimeFormat('zh-CN', { timeZone: preferences.timeZone, dateStyle: 'long', timeStyle: 'medium', hourCycle: 'h23' }).format(updatedAt)} · ${preferences.timeZone}`
  return <TooltipProvider><Tooltip><TooltipTrigger asChild><Badge variant="muted" tabIndex={0} aria-label={description}>
    {updatedAt === null ? <CircleHelp data-icon="inline-start" /> : <Clock3 data-icon="inline-start" />}{label}
  </Badge></TooltipTrigger><TooltipContent>{description}</TooltipContent></Tooltip></TooltipProvider>
}

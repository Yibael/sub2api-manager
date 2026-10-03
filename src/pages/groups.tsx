import { useState } from 'react'
import { Check, Pause, Search, SlidersHorizontal } from 'lucide-react'
import { useGroups } from '@/lib/groups'
import { ErrorNotice, ProviderMark, RefreshButton } from '@/components/common'
import { ResourcesHeading } from '@/components/resources-heading'
import { GroupRateEditor } from '@/components/group-rate-editor'
import { StableRegion, LoadingValue } from '@/components/loading'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { providerNames } from '../../shared/domain'
import { formatMultiplier, type Group } from '../../shared/groups'

function GroupBadges({ group }: { group: Group }) {
  return <div className="flex min-w-0 flex-wrap gap-1.5">
    <Badge variant="outline">{providerNames[group.platform] ?? group.platform}</Badge>
    <Badge variant="secondary">{group.subscriptionType === 'subscription' ? '订阅' : group.subscriptionType === 'standard' ? '按量' : '类型未知'}</Badge>
    {group.exclusive && <Badge variant="outline">专属</Badge>}
    {group.imageRateIndependent && <Badge variant="outline">图片独立倍率</Badge>}
  </div>
}
function GroupStatus({ group }: { group: Group }) {
  return <Badge variant={group.status === 'active' || group.status === 'inactive' ? 'secondary' : 'outline'}>{group.status === 'active' ? <Check data-icon="inline-start" /> : group.status === 'inactive' ? <Pause data-icon="inline-start" /> : null}{group.status === 'active' ? '启用' : group.status === 'inactive' ? '停用' : '状态未知'}</Badge>
}
function GroupSkeleton() {
  return <div className="flex flex-col gap-5" role="status" aria-label="正在读取分组">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex items-center justify-between gap-4"><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-36" /></div><Skeleton className="h-6 w-14" /><Skeleton className="h-8 w-20" /></div>)}</div>
}

export function GroupsPage() {
  const directory = useGroups(), [search, setSearch] = useState(''), [platform, setPlatform] = useState('all')
  const [editing, setEditing] = useState<Group | null>(null)
  const groups = directory.data?.data ?? [], message = directory.error?.message ?? directory.data?.error
  const pending = !directory.data?.data && !message
  const platforms = [...new Set(groups.map(group => group.platform))]
  const filtered = groups.filter(group => `${group.name} ${group.description} ${group.platform} ${group.id}`.toLowerCase().includes(search.toLowerCase()) && (platform === 'all' || group.platform === platform))
  return <div className="page-stack">
    <ResourcesHeading section="groups" action={<RefreshButton busy={directory.isFetching} onClick={() => void directory.refresh()} />} />
    <ErrorNotice message={message} />
    <div className="account-toolbar"><div className="search-box"><Search className="size-4" /><Input aria-label="搜索分组" placeholder="搜索名称、平台或分组 ID…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <Select value={platform} onValueChange={setPlatform}><SelectTrigger aria-label="筛选分组平台" className="w-full sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">全部平台</SelectItem>{platforms.map(value => <SelectItem key={value} value={value}>{providerNames[value] ?? value}</SelectItem>)}</SelectGroup></SelectContent></Select>
    </div>
    <Card className="min-w-0"><CardHeader><CardTitle>分组目录</CardTitle><CardDescription><Badge variant="secondary"><LoadingValue loading={pending}>{groups.length}</LoadingValue> 个分组</Badge></CardDescription></CardHeader>
      <CardContent><StableRegion phase={pending ? 'pending' : 'ready'} busy={directory.isFetching}>
        {pending ? <GroupSkeleton /> : filtered.length ? <>
          <div className="flex flex-col gap-5 md:hidden">{filtered.map(group => <div key={group.id} className="flex min-w-0 flex-col gap-4 border-t border-border pt-5 first:border-0 first:pt-0">
            <div className="flex min-w-0 items-start gap-3"><ProviderMark platform={group.platform} /><div className="flex min-w-0 flex-1 flex-col gap-2"><div className="flex min-w-0 items-start justify-between gap-2"><h3 className="min-w-0 break-words font-medium">{group.name}</h3><GroupStatus group={group} /></div><GroupBadges group={group} />{group.description && <p className="text-xs text-muted-foreground break-words">{group.description}</p>}</div></div>
            <div className="flex items-center justify-between gap-3"><div className="flex min-w-0 flex-col gap-1"><span className="text-xs text-muted-foreground">默认倍率</span><strong className="tabular-nums break-all">{formatMultiplier(group.rateMultiplier)}</strong></div><Button variant="outline" disabled={group.rateMultiplier === null} aria-label={`调整 ${group.name} 倍率`} onClick={() => setEditing(group)}><SlidersHorizontal data-icon="inline-start" />调整倍率</Button></div>
          </div>)}</div>
          <div className="hidden md:block"><Table aria-label="分组目录"><TableHeader><TableRow><TableHead>分组</TableHead><TableHead>状态</TableHead><TableHead className="text-right">默认倍率</TableHead><TableHead className="text-right"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{filtered.map(group => <TableRow key={group.id}>
            <TableCell className="min-w-0 whitespace-normal"><div className="flex items-start gap-3 py-2"><ProviderMark platform={group.platform} /><div className="flex min-w-0 flex-col gap-2"><span className="break-words font-medium">{group.name}</span><GroupBadges group={group} />{group.description && <p className="text-xs text-muted-foreground break-words">{group.description}</p>}</div></div></TableCell>
            <TableCell><GroupStatus group={group} /></TableCell><TableCell className="text-right tabular-nums">{formatMultiplier(group.rateMultiplier)}</TableCell><TableCell className="text-right"><Button variant="outline" disabled={group.rateMultiplier === null} aria-label={`调整 ${group.name} 倍率`} onClick={() => setEditing(group)}><SlidersHorizontal data-icon="inline-start" />调整倍率</Button></TableCell>
          </TableRow>)}</TableBody></Table></div>
        </> : <Empty><EmptyHeader><EmptyTitle>{message ? '分组暂不可用' : search || platform !== 'all' ? '没有匹配的分组' : '暂无分组'}</EmptyTitle></EmptyHeader></Empty>}
      </StableRegion></CardContent>
    </Card>
    {editing && <GroupRateEditor key={editing.id} group={editing} onClose={() => setEditing(null)} onSaved={directory.saved} />}
  </div>
}

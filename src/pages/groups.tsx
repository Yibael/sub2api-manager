import { useState } from 'react'
import { Check, Pause, Search, SlidersHorizontal } from 'lucide-react'
import { useGroups } from '@/lib/groups'
import { useNearViewport } from '@/lib/near-viewport'
import { EmptyState, ErrorNotice, ProviderMark } from '@/components/common'
import { GroupRateEditor } from '@/components/group-rate-editor'
import { StableRegion, LoadingValue, GroupDirectorySkeleton } from '@/components/loading'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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

export function GroupsPage() {
  const { ref: directoryRef, near } = useNearViewport()
  const directory = useGroups(near), [search, setSearch] = useState(''), [platform, setPlatform] = useState('all')
  const [editing, setEditing] = useState<Group | null>(null)
  const groups = directory.data?.data ?? [], message = directory.error?.message ?? directory.data?.error
  const pending = !directory.data?.data && !message
  const platforms = [...new Set(groups.map(group => group.platform))]
  const filtered = groups.filter(group => `${group.name} ${group.description} ${group.platform} ${group.id}`.toLowerCase().includes(search.toLowerCase()) && (platform === 'all' || group.platform === platform))
  return <div className="page-stack">
    <ErrorNotice message={message} />
    <div className="account-toolbar"><div className="search-box"><Search /><Input aria-label="搜索分组" placeholder="搜索名称、平台或分组 ID…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <Select value={platform} onValueChange={setPlatform}><SelectTrigger aria-label="筛选分组平台" className="w-full sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">全部平台</SelectItem>{platforms.map(value => <SelectItem key={value} value={value}>{providerNames[value] ?? value}</SelectItem>)}</SelectGroup></SelectContent></Select>
    </div>
    <Card ref={directoryRef} className="group-directory"><CardHeader><CardTitle><span className="flex items-center gap-2"><SlidersHorizontal className="size-4" />分组目录</span></CardTitle><CardDescription><Badge variant="secondary"><LoadingValue loading={pending}>{groups.length}</LoadingValue> 个分组</Badge></CardDescription></CardHeader>
      <CardContent><StableRegion phase={pending ? 'pending' : 'ready'} busy={directory.isFetching}>
        {pending ? <GroupDirectorySkeleton /> : filtered.length ? <>
          <div className="group-list">{filtered.map(group => <div key={group.id} className="group-row">
            <div className="flex min-w-0 items-start gap-3"><ProviderMark platform={group.platform} /><div className="flex min-w-0 flex-1 flex-col gap-2"><div className="flex min-w-0 items-start justify-between gap-2"><h3 className="directory-name">{group.name}</h3><GroupStatus group={group} /></div><GroupBadges group={group} />{group.description && <p className="content-meta break-words">{group.description}</p>}</div></div>
            <div className="flex items-center justify-between gap-3"><div className="flex min-w-0 flex-col gap-1"><span className="text-xs text-muted-foreground">默认倍率</span><strong className="tabular-nums break-all">{formatMultiplier(group.rateMultiplier)}</strong></div><Button variant="outline" disabled={group.rateMultiplier === null} aria-label={`调整 ${group.name} 倍率`} onClick={() => setEditing(group)}><SlidersHorizontal data-icon="inline-start" />调整倍率</Button></div>
          </div>)}</div>
          <div className="group-table"><Table aria-label="分组目录"><TableHeader><TableRow><TableHead>分组</TableHead><TableHead>状态</TableHead><TableHead className="text-right">默认倍率</TableHead><TableHead className="text-right"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{filtered.map(group => <TableRow key={group.id}>
            <TableCell className="min-w-0 whitespace-normal"><div className="flex items-start gap-3 py-2"><ProviderMark platform={group.platform} /><div className="flex min-w-0 flex-col gap-2"><span className="directory-name">{group.name}</span><GroupBadges group={group} />{group.description && <p className="content-meta break-words">{group.description}</p>}</div></div></TableCell>
            <TableCell><GroupStatus group={group} /></TableCell><TableCell className="text-right tabular-nums">{formatMultiplier(group.rateMultiplier)}</TableCell><TableCell className="text-right"><Button variant="outline" disabled={group.rateMultiplier === null} aria-label={`调整 ${group.name} 倍率`} onClick={() => setEditing(group)}><SlidersHorizontal data-icon="inline-start" />调整倍率</Button></TableCell>
          </TableRow>)}</TableBody></Table></div>
        </> : <EmptyState title={message ? '分组暂不可用' : search || platform !== 'all' ? '没有匹配的分组' : '暂无分组'} />}
      </StableRegion></CardContent>
    </Card>
    {editing && <GroupRateEditor key={editing.id} group={editing} onClose={() => setEditing(null)} onSaved={directory.saved} />}
  </div>
}

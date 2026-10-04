import { useEffect, useRef, useState } from 'react'
import { Ticket, CircleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api, pageSession, queryClient } from '@/lib/api'
import { useManualQuery } from '@/lib/manual-query'
import { useWorkspace } from '@/lib/preferences'
import { applyResetCardData } from '@/lib/reset-card-cache'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogHeader, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { ErrorNotice, QuotaList, RefreshButton } from '@/components/common'
import { QueryTimeBadge } from '@/components/query-time-badge'
import type { ResetCardOperation, ResetCardPreview, ResetCardResult } from '../../shared/reset-card'
import type { QuotaBenefits } from '../../shared/benefits'

export function ResetCardAction({ id, count, now, near, refreshing, refresh }: {
  id: number; count: number | null; now: number; near: boolean; refreshing: boolean; refresh: () => Promise<QuotaBenefits | undefined>;
}) {
  const { config } = useWorkspace()
  const operationKey = ['reset-card-operation', config.instanceId, id]
  const receipt = useManualQuery<ResetCardOperation | null>(operationKey, async (_, signal) => (await api<{ operation: ResetCardOperation | null }>(`/accounts/${id}/reset-card/operation`, undefined, signal)).operation, near)
  const operation = receipt.data
  const [open, setOpen] = useState(false), [preview, setPreview] = useState<ResetCardPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'save' | 'review' | null>(null), [error, setError] = useState<string>()
  const [review, setReview] = useState(false), [checkedOperationId, setCheckedOperationId] = useState<string | null>(null)
  const active = useRef(true), lock = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const unresolved = operation && ['uncertain', 'executing'].includes(operation.state)
  const expired = !!preview && now >= preview.expiresAt
  async function prepare() {
    if (lock.current) return
    lock.current = true
    const epoch = pageSession.epoch
    setOpen(true); setPreview(null); setBusy('preview'); setError(undefined)
    try {
      const next = await api<ResetCardPreview>(`/accounts/${id}/reset-card/preview`, {})
      pageSession.assertCurrent(epoch)
      await applyResetCardData(config.instanceId, id, epoch, { quota: next.quota, benefits: next.benefits })
      if (active.current) setPreview(next)
    } catch (error) { if (active.current) setError((error as Error).message) }
    finally { lock.current = false; if (active.current) setBusy(null) }
  }
  function cancel() {
    if (busy) return
    setOpen(false); setPreview(null)
    if (preview) void api(`/accounts/${id}/reset-card/cancel`, { token: preview.token }).catch(() => {})
  }
  async function save() {
    if (!preview || lock.current || expired) return
    lock.current = true
    const epoch = pageSession.epoch
    setBusy('save'); setError(undefined)
    try {
      const result = await api<ResetCardResult>(`/accounts/${id}/reset-card/confirm`, { token: preview.token })
      pageSession.assertCurrent(epoch)
      queryClient.setQueryData(operationKey, result.operation)
      await applyResetCardData(config.instanceId, id, epoch, result, result.operation.state !== 'rejected')
      if (active.current) { setOpen(false); setPreview(null) }
      if (result.operation.state === 'success') toast.success(result.operation.message)
      else toast.warning(result.operation.message)
    } catch (error) {
      if (active.current) { setPreview(null); setError(`${(error as Error).message}。请核对操作结果，不要直接重复用卡。`) }
      if (pageSession.epoch === epoch) await receipt.forceRefresh()
    } finally { lock.current = false; if (active.current) setBusy(null) }
  }
  async function checkQuota() {
    setCheckedOperationId(null)
    const result = await refresh()
    if (result?.resetCredits.data && !result.resetCredits.error && result.resetCredits.updatedAt !== null) setCheckedOperationId(operation?.id ?? null)
  }
  async function acknowledge() {
    if (!operation || lock.current) return
    lock.current = true
    setBusy('review')
    try {
      const result = await api<ResetCardOperation>(`/accounts/${id}/reset-card/acknowledge`, { operationId: operation.id })
      queryClient.setQueryData(operationKey, result); setReview(false)
    } catch (error) { toast.error((error as Error).message) }
    finally { lock.current = false; if (active.current) setBusy(null) }
  }
  return <><div className="flex items-center gap-2">
    <RefreshButton mode="icon" busy={refreshing} label="查询最新重置卡与 Credits" onClick={() => void refresh()} />
    <Button type="button" variant="outline" disabled={!!busy || refreshing || !receipt.isFetchedAfterMount || !!receipt.error || !!unresolved || count === null || count === 0} onClick={() => void prepare()}>
      <Ticket data-icon="inline-start" />使用 1 张
    </Button>
  </div>
    <ErrorNotice message={receipt.error?.message} />
    {operation && operation.state !== 'success' && <Alert className="reset-card-receipt"><CircleAlert /><AlertTitle>{operation.state === 'uncertain' ? '结果待确认' : operation.state === 'partial' ? '已用卡，数据待更新' : operation.state === 'executing' ? '用卡处理中' : operation.state === 'reviewed' ? '已核对' : '请求未完成'}</AlertTitle>
      <AlertDescription><p>{operation.message}</p>{['partial', 'uncertain'].includes(operation.state) && <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={refreshing || !!busy} onClick={() => void checkQuota()}>查询额度并核对</Button>
        {operation.state === 'uncertain' && <Button variant="outline" size="sm" disabled={checkedOperationId !== operation.id || refreshing || !!busy} onClick={() => setReview(true)}>已核对结果</Button>}
      </div>}</AlertDescription></Alert>}
    <AlertDialog open={open} onOpenChange={value => { if (!value) cancel() }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>使用 1 张重置卡？</AlertDialogTitle><AlertDialogDescription>将消耗 1 张重置卡恢复当前账号额度。</AlertDialogDescription></AlertDialogHeader>
      {busy === 'preview' ? <div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-5 w-40" /><QuotaList quotas={[]} pending empty="" now={now} /><span className="sr-only">正在查询当前额度</span></div>
        : preview && <div className="flex flex-col gap-4"><dl className="data-list"><div><dt>账号</dt><dd className="break-words">{preview.account.name} · #{id}</dd></div><div><dt>可用重置卡</dt><dd><Badge variant="secondary">{preview.availableCount} 张</Badge></dd></div><div><dt>自动用卡</dt><dd><Badge variant="outline">{preview.autoReset.enabled ? '开启' : '关闭'}</Badge></dd></div></dl>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">当前额度</span><QueryTimeBadge updatedAt={preview.quota.updatedAt} /></div>
          <QuotaList quotas={preview.quota.data?.windows ?? []} pending={false} empty="额度未知" now={now} />
          {preview.autoReset.enabled && <p className="text-xs text-muted-foreground">自动用卡已开启，Sub2API 仍可能同时执行自动用卡。</p>}
        </div>}
      <ErrorNotice message={error ?? (expired ? '确认已过期，请重新查询额度。' : undefined)} />
      <AlertDialogFooter><AlertDialogCancel disabled={!!busy}>取消</AlertDialogCancel>{!preview || expired
        ? <Button disabled={!!busy} onClick={() => void prepare()}>{busy === 'preview' ? <Spinner data-icon="inline-start" /> : null}{busy === 'preview' ? '查询中…' : '重新查询'}</Button>
        : <AlertDialogAction disabled={!!busy} onClick={event => { event.preventDefault(); void save() }}>{busy === 'save' && <Spinner data-icon="inline-start" />}{busy === 'save' ? '用卡中…' : '确认使用 1 张'}</AlertDialogAction>}</AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <AlertDialog open={review} onOpenChange={setReview}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认已核对用卡结果？</AlertDialogTitle><AlertDialogDescription>请结合最新额度和卡片数量确认结果。解除待确认状态后，再次用卡会发起新的请求，可能再消耗 1 张卡。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy === 'review'}>取消</AlertDialogCancel><AlertDialogAction disabled={busy === 'review'} onClick={event => { event.preventDefault(); void acknowledge() }}>{busy === 'review' && <Spinner data-icon="inline-start" />}我已核对</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>
}

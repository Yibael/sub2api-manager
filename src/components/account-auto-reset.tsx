import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError, pageSession, queryClient } from '@/lib/api'
import { useWorkspace } from '@/lib/preferences'
import { useCompletionQuery } from '@/lib/completion-query'
import { useForeground } from '@/lib/monitor'
import { ErrorNotice } from '@/components/common'
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Field, FieldContent, FieldDescription, FieldTitle } from '@/components/ui/field'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { formatResetThreshold, type AutoResetConfig, type AutoResetPreview } from '../../shared/auto-reset'
import type { Account, Sample } from '../../shared/domain'

export function AccountAutoResetCard({ account, stale }: { account: Account; stale: boolean }) {
  const { config } = useWorkspace(), visible = useForeground()
  const query = useCompletionQuery<Sample<AutoResetConfig>>(['auto-reset', config.instanceId, account.id], config.intervals.status, visible,
    (_, signal) => api(`/accounts/${account.id}/auto-reset`, undefined, signal), { refetchOnMount: 'always' })
  const [preview, setPreview] = useState<AutoResetPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null), [expired, setExpired] = useState(false)
  const [error, setError] = useState<string>()
  const active = useRef(true), lock = useRef(false)
  const readError = query.error?.message ?? query.data?.error
  const loading = !query.isFetchedAfterMount && (query.isFetching || !readError)
  const current = query.isFetchedAfterMount ? query.data?.data : null
  const unavailable = !loading && (stale || !!readError)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (!preview) return
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, preview.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [preview])
  function cancel() {
    if (busy === 'save') return
    const previous = preview
    setPreview(null); setExpired(false)
    if (previous) void api(`/accounts/${account.id}/auto-reset/cancel`, { token: previous.token }).catch(() => {})
  }
  async function prepare(enabled: boolean) {
    if (lock.current || !current || loading || unavailable) return
    lock.current = true
    setBusy('preview'); setError(undefined)
    try {
      const next = await api<AutoResetPreview>(`/accounts/${account.id}/auto-reset/preview`, { enabled })
      if (active.current) { setExpired(false); setPreview(next) }
    } catch (error) { if (active.current) setError((error as Error).message) }
    finally { lock.current = false; if (active.current) setBusy(null) }
  }
  async function refreshSaved(epoch: number, saved?: Account) {
    const key = ['status', config.instanceId]
    const resetKey = ['auto-reset', config.instanceId, account.id]
    await Promise.all([queryClient.cancelQueries({ queryKey: key }), queryClient.cancelQueries({ queryKey: resetKey })])
    pageSession.assertCurrent(epoch)
    if (saved) queryClient.setQueriesData<Record<number, Sample<Account>>>({ queryKey: key }, previous => previous?.[account.id]
      ? { ...previous, [account.id]: { data: saved, error: null, updatedAt: Date.now() } } : previous)
    if (saved) queryClient.setQueryData<Sample<AutoResetConfig>>(resetKey, { data: saved.autoReset, error: null, updatedAt: Date.now() })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: resetKey }),
      queryClient.invalidateQueries({ queryKey: ['accounts', config.instanceId] }),
      queryClient.invalidateQueries({ queryKey: ['benefits', config.instanceId, account.id] }),
    ])
  }
  async function save() {
    if (!preview || lock.current || expired) return
    lock.current = true
    const epoch = pageSession.epoch
    setBusy('save'); setError(undefined)
    try {
      const saved = await api<Account>(`/accounts/${account.id}/auto-reset`, { token: preview.token }, undefined, 'PUT')
      pageSession.assertCurrent(epoch)
      await refreshSaved(epoch, saved)
      pageSession.assertCurrent(epoch)
      if (active.current) { setPreview(null); toast.success(`自动使用重置卡已${saved.autoReset?.enabled ? '开启' : '关闭'}`) }
    } catch (error) {
      if (active.current) {
        setPreview(null)
        setError(error instanceof ApiError && error.status === 409 ? error.message : `${(error as Error).message}。请核对刷新后的开关状态。`)
      }
      if (pageSession.epoch === epoch) await refreshSaved(epoch).catch(() => {})
    } finally { lock.current = false; if (active.current) setBusy(null) }
  }
  return <><Card><CardHeader><CardTitle>自动使用重置卡</CardTitle><CardAction><Badge variant="secondary">{loading ? '读取中' : unavailable ? '状态待更新' : current ? current.enabled ? '已开启' : '已关闭' : '不支持'}</Badge></CardAction></CardHeader>
    <CardContent className="flex flex-col gap-5">
      {current || loading || unavailable ? <>
        <Field orientation="horizontal" data-disabled={!!busy || loading || unavailable}>
          <FieldContent><FieldTitle id={`auto-reset-label-${account.id}`}>自动用卡</FieldTitle><FieldDescription id={`auto-reset-desc-${account.id}`}>达到任一阈值时，自动用卡恢复额度。</FieldDescription></FieldContent>
          <div className="flex min-w-8 items-center justify-center" aria-busy={loading || busy === 'preview'}>
            {loading || busy === 'preview' ? <Spinner aria-label={loading ? '正在读取自动用卡配置' : '正在检查变更'} /> : current
              ? <Switch id={`auto-reset-${account.id}`} aria-labelledby={`auto-reset-label-${account.id}`} aria-describedby={`auto-reset-desc-${account.id}`} checked={current.enabled} disabled={!!busy || !!preview || unavailable} onCheckedChange={enabled => void prepare(enabled)} />
              : <span className="text-sm text-muted-foreground" aria-label="自动用卡状态未知">—</span>}
          </div>
        </Field>
        <dl className="data-list"><div><dt>5 小时触发阈值</dt><dd className="tabular-nums">{current ? formatResetThreshold(current.threshold5h) : '—'}</dd></div><div><dt>7 日触发阈值</dt><dd className="tabular-nums">{current ? formatResetThreshold(current.threshold7d) : '—'}</dd></div></dl>
        {unavailable && <ErrorNotice message={readError ?? '账号状态读取失败，请刷新后再修改自动用卡配置。'} />}
      </> : <p className="text-sm text-muted-foreground">仅 OpenAI OAuth 母账号支持自动使用重置卡。</p>}
      <ErrorNotice message={error} />
    </CardContent></Card>
    <AlertDialog open={!!preview} onOpenChange={open => { if (!open) cancel() }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>确认{preview?.enabled ? '开启' : '关闭'}自动使用重置卡？</AlertDialogTitle><AlertDialogDescription>{preview?.enabled ? '开启后，Sub2API 会按下列阈值自动消耗可用重置卡恢复额度。' : '关闭后，Sub2API 将停止为此账号发起新的自动用卡操作。已经发出的用卡请求可能仍会完成。'}</AlertDialogDescription></AlertDialogHeader>
      {preview && <dl className="data-list"><div><dt>账号</dt><dd className="min-w-0 break-words">{preview.account.name} · #{preview.account.id}</dd></div><div><dt>自动用卡</dt><dd>{preview.current.enabled ? '开启' : '关闭'} → {preview.enabled ? '开启' : '关闭'}</dd></div><div><dt>5 小时触发阈值</dt><dd>{formatResetThreshold(preview.current.threshold5h)}</dd></div><div><dt>7 日触发阈值</dt><dd>{formatResetThreshold(preview.current.threshold7d)}</dd></div></dl>}
      {expired && <ErrorNotice message="确认已过期，请取消后重新检查变更。" />}
      <AlertDialogFooter><AlertDialogCancel disabled={busy === 'save'}>取消</AlertDialogCancel><AlertDialogAction disabled={!!busy || expired} onClick={event => { event.preventDefault(); void save() }}>{busy === 'save' && <Spinner data-icon="inline-start" />}{busy === 'save' ? '保存中…' : '确认保存'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>
}

import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { useManualQuery } from '@/lib/manual-query'
import { useWorkspace } from '@/lib/preferences'
import { ErrorNotice, RefreshButton } from '@/components/common'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { availableResetCredits, formatCredits, type BenefitSample, type QuotaBenefits, type ReferralBenefits } from '../../shared/benefits'
import type { Account } from '../../shared/domain'

function BenefitNotices({ error, samples }: { error: Error | null; samples: [string, BenefitSample<unknown>][] }) {
  const errors = [...new Set([error?.message, ...samples.map(([, sample]) => sample.error)].filter(Boolean))]
  const warnings = samples.filter(([, sample]) => sample.warning)
  return <>
    <ErrorNotice message={errors.join('；')} />
    {warnings.length > 0 && <Alert><CircleAlert /><AlertTitle>查询结果保存提示</AlertTitle><AlertDescription><ul className="flex flex-col gap-1">{warnings.map(([label, sample]) => <li key={label}>{label}：{sample.warning}</li>)}</ul></AlertDescription></Alert>}
  </>
}

export function AccountBenefitsCard({ account, now }: { account: Account; now: number }) {
  const { config, preferences } = useWorkspace()
  const [initialBenefits] = useState(account.benefits!)
  const [showExpirations, setShowExpirations] = useState(false)
  const quota = useManualQuery<QuotaBenefits>(['benefits', config.instanceId, account.id, 'quota'],
    (force, signal) => api(`/accounts/${account.id}/benefits/quota`, force ? {} : undefined, signal))
  const referrals = useManualQuery<ReferralBenefits>(['benefits', config.instanceId, account.id, 'referrals'],
    (force, signal) => api(`/accounts/${account.id}/benefits/referrals`, force ? {} : undefined, signal))
  const quotaData = quota.data ?? initialBenefits, referralData = referrals.data ?? initialBenefits
  const expirations = quotaData.resetCredits.data?.expiresAt.filter(time => Date.parse(time) > now) ?? []
  const date = (time: string | number) => new Intl.DateTimeFormat('zh-CN', { timeZone: preferences.timeZone,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(time))
  const fullDate = (time: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: preferences.timeZone,
    dateStyle: 'long', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(time))
  const queryTime = (updatedAt: number | null) => <p className="query-time" title={updatedAt === null ? '此快照的查询时间未知' : new Date(updatedAt).toLocaleString('zh-CN', { timeZone: preferences.timeZone })}>查询于 {updatedAt === null ? '—' : date(updatedAt)}</p>
  return <Drawer open={showExpirations} onOpenChange={setShowExpirations}><Card className="benefits-card">
    <CardHeader>
      <CardTitle>账号权益</CardTitle>
      <CardDescription>点击各项刷新按钮查询最新信息</CardDescription>
    </CardHeader>
    <CardContent className="benefits-content">
      <section className="flex min-w-0 flex-col gap-4" aria-labelledby={`benefits-quota-${account.id}`}>
        <div className="benefit-heading">
          <h3 id={`benefits-quota-${account.id}`}>重置卡与 Credits</h3>
          <RefreshButton mode="icon" busy={quota.isFetching} label="查询最新重置卡与 Credits" onClick={() => void quota.forceRefresh()} />
        </div>
        <div className="detail-metrics benefits-quota-metrics">
          <div className="min-w-0"><p>重置卡</p><strong className="tabular-nums">{availableResetCredits(quotaData.resetCredits, now)?.toLocaleString() ?? '—'}</strong>
            {queryTime(quotaData.resetCredits.updatedAt)}
          </div>
          <div className="min-w-0"><p>Credits</p><strong className="tabular-nums">{formatCredits(quotaData.credits.data)}</strong>
            {queryTime(quotaData.credits.updatedAt)}
          </div>
        </div>
        {expirations.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">最近到期 <time dateTime={expirations[0]} title={fullDate(expirations[0])}>{date(expirations[0])}</time></p>
          {expirations.length > 1 && <DrawerTrigger asChild><Button type="button" variant="ghost" size="sm">查看全部 {expirations.length} 张</Button></DrawerTrigger>}
        </div>}
        <BenefitNotices error={quota.error} samples={[["重置卡", quotaData.resetCredits], ["Credits", quotaData.credits]]} />
      </section>
      <Separator orientation="vertical" className="benefits-divider" />
      <section className="flex min-w-0 flex-col gap-4" aria-labelledby={`benefits-referrals-${account.id}`}>
        <Separator className="benefits-mobile-divider" />
        <div className="benefit-heading">
          <h3 id={`benefits-referrals-${account.id}`}>邀请</h3>
          <RefreshButton mode="icon" busy={referrals.isFetching} label="查询最新可邀请数量" onClick={() => void referrals.forceRefresh()} />
        </div>
        <div className="detail-metrics benefits-referral-metrics">
          <div className="min-w-0"><p>可邀请数量</p><strong className="tabular-nums">{referralData.referrals.data?.availableInvites?.toLocaleString() ?? '—'}</strong>
            {queryTime(referralData.referrals.updatedAt)}
          </div>
        </div>
        <BenefitNotices error={referrals.error} samples={[["可邀请数量", referralData.referrals]]} />
      </section>
    </CardContent>
  </Card><DrawerContent className="mx-auto max-w-lg"><DrawerHeader><DrawerTitle>重置卡到期时间</DrawerTitle><DrawerDescription>按到期时间排列 · {preferences.timeZone}</DrawerDescription></DrawerHeader>
    <div className="drawer-form"><dl className="data-list">{expirations.map((time, index) => <div key={`${time}-${index}`}><dt>第 {index + 1} 张</dt><dd><time dateTime={time}>{fullDate(time)}</time></dd></div>)}</dl></div>
    <DrawerFooter><DrawerClose asChild><Button type="button" variant="outline">关闭</Button></DrawerClose></DrawerFooter>
  </DrawerContent></Drawer>
}

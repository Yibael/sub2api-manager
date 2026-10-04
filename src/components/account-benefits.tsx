import { useState } from 'react'
import { CalendarClock, CircleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { useManualQuery } from '@/lib/manual-query'
import { useNearViewport } from '@/lib/near-viewport'
import { useWorkspace } from '@/lib/preferences'
import { ErrorNotice, RefreshButton } from '@/components/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { AccountAutoResetControls } from '@/components/account-auto-reset'
import { ResetCardAction } from '@/components/reset-card-action'
import { QueryTimeBadge } from '@/components/query-time-badge'
import { availableResetCredits, formatCredits, type BenefitSample, type QuotaBenefits, type ReferralBenefits } from '../../shared/benefits'
import type { Account } from '../../shared/domain'

function BenefitNotices({ error, samples }: { error: Error | null; samples: [string, BenefitSample<unknown>][] }) {
  const errors = [...new Set([error?.message, ...samples.map(([, sample]) => sample.error)].filter(Boolean))]
  const warnings = samples.filter(([, sample]) => sample.warning)
  return <><ErrorNotice message={errors.join('；')} />{warnings.length > 0 && <Alert><CircleAlert /><AlertTitle>查询结果保存提示</AlertTitle><AlertDescription><ul className="flex flex-col gap-1">{warnings.map(([label, sample]) => <li key={label}>{label}：{sample.warning}</li>)}</ul></AlertDescription></Alert>}</>
}
export function AccountBenefitsCard({ account, now, stale }: { account: Account; now: number; stale: boolean }) {
  const { config, preferences } = useWorkspace()
  const [initialBenefits] = useState(account.benefits!)
  const [showExpirations, setShowExpirations] = useState(false)
  const { ref: resetRef, near: resetNear } = useNearViewport<HTMLDivElement>()
  const { ref: creditRef, near: creditNear } = useNearViewport<HTMLElement>()
  const { ref: referralRef, near: referralNear } = useNearViewport<HTMLElement>()
  const near = resetNear || creditNear
  const quota = useManualQuery<QuotaBenefits>(['benefits', config.instanceId, account.id, 'quota'],
    (force, signal) => api(`/accounts/${account.id}/benefits/quota`, force ? {} : undefined, signal), near)
  const referrals = useManualQuery<ReferralBenefits>(['benefits', config.instanceId, account.id, 'referrals'],
    (force, signal) => api(`/accounts/${account.id}/benefits/referrals`, force ? {} : undefined, signal), referralNear)
  const quotaData = quota.data ?? initialBenefits, referralData = referrals.data ?? initialBenefits
  const count = availableResetCredits(quotaData.resetCredits, now)
  const expirations = quotaData.resetCredits.data?.expiresAt.filter(time => Date.parse(time) > now) ?? []
  const date = (time: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: preferences.timeZone,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(time))
  const fullDate = (time: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: preferences.timeZone,
    dateStyle: 'long', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(time))
  const expirationDescription = expirations.length > 0 ? `最近到期 ${fullDate(expirations[0])} · ${preferences.timeZone}` : ''
  const refresh = <RefreshButton mode="icon" busy={quota.isFetching} label="查询最新重置卡与 Credits" onClick={() => void quota.forceRefresh()} />
  return <>
    <Drawer open={showExpirations} onOpenChange={setShowExpirations}><Card ref={resetRef} className="directory-card"><CardHeader><CardTitle>重置卡</CardTitle></CardHeader><Separator />
      <CardContent className="flex flex-col gap-4">
        <div className="benefit-data-row reset-card-inventory"><div className="detail-metrics"><div><p>可用重置卡</p><strong className="tabular-nums">{count?.toLocaleString() ?? '—'}</strong><div className="mt-2"><QueryTimeBadge updatedAt={quotaData.resetCredits.updatedAt} /></div></div></div>
          {account.autoReset ? <ResetCardAction id={account.id} count={count} now={now} near={resetNear} refreshing={quota.isFetching} refresh={quota.forceRefresh} /> : refresh}
        </div>
        {expirations.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2"><TooltipProvider><Tooltip><TooltipTrigger asChild><Badge variant="muted" tabIndex={0} aria-label={expirationDescription}><CalendarClock data-icon="inline-start" />最近到期 <time dateTime={expirations[0]}>{date(expirations[0])}</time></Badge></TooltipTrigger><TooltipContent>{expirationDescription}</TooltipContent></Tooltip></TooltipProvider>{expirations.length > 1 && <DrawerTrigger asChild><Button type="button" variant="ghost" size="sm">查看全部 {expirations.length} 张</Button></DrawerTrigger>}</div>}
        <BenefitNotices error={quota.error} samples={[["重置卡", quotaData.resetCredits]]} />
        {account.autoReset && <><Separator /><AccountAutoResetControls account={account} stale={stale} near={resetNear} /></>}
      </CardContent>
    </Card><DrawerContent className="mx-auto max-w-lg"><DrawerHeader><DrawerTitle>重置卡到期时间</DrawerTitle><DrawerDescription>按到期时间排列 · {preferences.timeZone}</DrawerDescription></DrawerHeader><div className="drawer-form"><dl className="data-list">{expirations.map((time, index) => <div key={`${time}-${index}`}><dt>第 {index + 1} 张</dt><dd><time dateTime={time}>{fullDate(time)}</time></dd></div>)}</dl></div><DrawerFooter><DrawerClose asChild><Button type="button" variant="outline">关闭</Button></DrawerClose></DrawerFooter></DrawerContent></Drawer>
    <Card className="directory-card benefits-card"><CardHeader><CardTitle>账号权益</CardTitle></CardHeader><Separator /><CardContent className="benefits-content">
      <section ref={creditRef} className="flex min-w-0 flex-col gap-4" aria-labelledby={`benefits-credits-${account.id}`}>
        <div className="benefit-heading"><h3 id={`benefits-credits-${account.id}`}>Credits</h3></div>
        <div className="benefit-data-row"><div className="detail-metrics benefits-referral-metrics"><div><strong className="tabular-nums">{formatCredits(quotaData.credits.data)}</strong><div className="mt-2"><QueryTimeBadge updatedAt={quotaData.credits.updatedAt} /></div></div></div>{refresh}</div>
        <BenefitNotices error={quota.error} samples={[["Credits", quotaData.credits]]} />
      </section>
      <Separator orientation="vertical" className="benefits-divider" />
      <section ref={referralRef} className="flex min-w-0 flex-col gap-4" aria-labelledby={`benefits-referrals-${account.id}`}><Separator className="benefits-mobile-divider" />
        <div className="benefit-heading"><h3 id={`benefits-referrals-${account.id}`}>邀请</h3></div>
        <div className="benefit-data-row"><div className="detail-metrics benefits-referral-metrics"><div><p>可邀请数量</p><strong className="tabular-nums">{referralData.referrals.data?.availableInvites?.toLocaleString() ?? '—'}</strong><div className="mt-2"><QueryTimeBadge updatedAt={referralData.referrals.updatedAt} /></div></div></div><RefreshButton mode="icon" busy={referrals.isFetching} label="查询最新可邀请数量" onClick={() => void referrals.forceRefresh()} /></div>
        <BenefitNotices error={referrals.error} samples={[["可邀请数量", referralData.referrals]]} />
      </section>
    </CardContent></Card>
  </>
}

import { pageSession, queryClient } from './api'
import type { Account, Sample, Usage } from '../../shared/domain'
import type { QuotaBenefits } from '../../shared/benefits'

/** Seed the exact returned data; disabled manual queries stay disabled. */
export async function applyResetCardData(instanceId: string, id: number, epoch: number,
  data: { account?: Account | null; quota?: Sample<Usage> | null; benefits?: QuotaBenefits | null }, invalidate = false) {
  const statusKey = ['status', instanceId], quotaKey = ['quota', instanceId], benefitKey = ['benefits', instanceId, id, 'quota'], autoKey = ['auto-reset', instanceId, id]
  await Promise.all([statusKey, quotaKey, benefitKey, autoKey, ['accounts', instanceId]].map(queryKey => queryClient.cancelQueries({ queryKey })))
  pageSession.assertCurrent(epoch)
  const now = Date.now()
  if (data.benefits) queryClient.setQueryData(benefitKey, data.benefits)
  else if (invalidate) queryClient.setQueryData<QuotaBenefits>(benefitKey, {
    resetCredits: { data: null, updatedAt: null, error: '用卡后权益待更新，请手动查询', warning: null },
    credits: { data: null, updatedAt: null, error: '用卡后权益待更新，请手动查询', warning: null },
  })
  if (data.quota || invalidate) queryClient.setQueriesData<Record<number, Sample<Usage>>>({ queryKey: quotaKey }, previous => previous?.[id]
    ? { ...previous, [id]: data.quota ?? { data: null, updatedAt: null, error: '用卡后额度待更新，请手动查询' } } : previous)
  if (data.account) {
    const account = data.account
    queryClient.setQueriesData<Record<number, Sample<Account>>>({ queryKey: statusKey }, previous => previous?.[id]
      ? { ...previous, [id]: { data: account, updatedAt: now, error: null } } : previous)
    queryClient.setQueryData(autoKey, { data: account.autoReset, updatedAt: now, error: null })
    queryClient.setQueryData<Sample<Account[]>>(['accounts', instanceId], previous => previous?.data
      ? { ...previous, data: previous.data.map(v => v.id === id ? account : v) } : previous)
  }
}

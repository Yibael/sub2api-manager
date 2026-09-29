import { useEffect, useState } from 'react'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, Layers, ChartNoAxesCombined, Settings2, Eye, EyeOff, Download } from 'lucide-react'
import { api, queryClient } from '@/lib/api'
import { PreferencesProvider, useWorkspace } from '@/lib/preferences'
import { Brand, ErrorNotice } from '@/components/common'
import { PwaUpdate } from '@/components/pwa'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { SetupPage } from '@/pages/setup'
import type { PublicConfig } from '../../shared/domain'

const navigation = [{ to: '/', label: '概览', icon: LayoutDashboard }, { to: '/accounts', label: '账号', icon: Layers }, { to: '/statistics', label: '统计', icon: ChartNoAxesCombined }, { to: '/settings', label: '设置', icon: Settings2 }] as const
export function Root() {
  const config = useQuery({ queryKey: ['config'], queryFn: ({ signal }) => api<PublicConfig>('/config', undefined, signal), staleTime: 60_000 })
  useEffect(() => {
    const expired = () => {
      void queryClient.cancelQueries({ predicate: q => q.queryKey[0] !== 'config' })
      queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'config' })
      queryClient.setQueryData<PublicConfig>(['config'], old => old ? { ...old, authenticated: false } : old)
    }
    window.addEventListener('session-expired', expired)
    return () => window.removeEventListener('session-expired', expired)
  }, [])
  if (!config.data) return <main className="loading-screen"><Brand />{config.error ? <><ErrorNotice message={config.error.message} /><Button onClick={() => void config.refetch()}>重试连接</Button></> : <Skeleton className="h-40 w-full max-w-sm" />}</main>
  if (!config.data.configured || !config.data.authenticated) return <SetupPage config={config.data} />
  return <PreferencesProvider key={config.data.instanceId} config={config.data}><Shell /><Toaster position="top-center" richColors /></PreferencesProvider>
}
function Shell() {
  const { config, preferences, update } = useWorkspace()
  const pathname = useRouterState({ select: state => state.location.pathname })
  const current = navigation.find(item => item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)) ?? navigation[0]
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => { setOnline(true); void queryClient.invalidateQueries({ predicate: q => q.meta?.poll === true }) }, off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return <div className="app-shell"><aside className="desktop-sidebar"><Link to="/" aria-label="返回概览"><Brand /></Link><div className="sidebar-workspace"><span className="workspace-avatar">S</span><div><strong>{config.instanceName}</strong></div></div><p className="nav-label">工作空间</p><nav aria-label="主导航" className="desktop-nav">{navigation.map(item => <Link key={item.to} to={item.to} className="nav-item" data-active={current.to === item.to}><item.icon /><span>{item.label}</span>{item.to === '/accounts' && <span className="nav-count">{preferences.pins.length}</span>}</Link>)}</nav><div className="sidebar-bottom"><Link className="nav-item" to="/settings/app"><Download /><span>安装应用</span></Link></div></aside>
    <div className="app-main"><header className="topbar"><div className="mobile-brand"><Brand compact /></div><div className="breadcrumb"><span>工作空间</span><span>/</span><strong>{current.label}</strong></div><div className="topbar-actions"><Button variant="ghost" size="icon" aria-label={preferences.hideAmounts ? '显示金额' : '隐藏金额'} onClick={() => update({ hideAmounts: !preferences.hideAmounts })}>{preferences.hideAmounts ? <EyeOff /> : <Eye />}</Button></div></header><main className="main-content"><PwaUpdate />{!online && <div className="mb-5"><ErrorNotice message="网络已断开" /></div>}<Outlet /></main></div><nav aria-label="移动导航" className="mobile-nav">{navigation.map(item => <Link key={item.to} to={item.to} data-active={current.to === item.to}><item.icon /><span>{item.label}</span></Link>)}</nav></div>
}

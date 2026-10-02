import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, Layers, ChartNoAxesCombined, Settings2, Download } from 'lucide-react'
import { loadConfig, queryClient, lockSession } from '@/lib/api'
import { pageSession, bindPageLifecycle } from '@/lib/page-session'
import { PreferencesMigration } from '@/components/preferences-migration'
import { PreferencesProvider, useWorkspace } from '@/lib/preferences'
import { Brand, ErrorNotice } from '@/components/common'
import { PwaUpdate } from '@/components/pwa'
import { Button } from '@/components/ui/button'
import { LoadingValue, LoginSkeleton, RouteSkeleton, StableRegion } from '@/components/loading'
import { Toaster } from '@/components/ui/sonner'
import { SetupPage } from '@/pages/setup'

const navigation = [{ to: '/', label: '概览', icon: LayoutDashboard }, { to: '/accounts', label: '账号', icon: Layers }, { to: '/statistics', label: '统计', icon: ChartNoAxesCombined }, { to: '/settings', label: '设置', icon: Settings2 }] as const
export function Root() {
  const config = useQuery({ queryKey: ['config'], queryFn: ({ signal }) => loadConfig(signal), staleTime: 60_000 })
  useSyncExternalStore(pageSession.subscribe, pageSession.getSnapshot, pageSession.getSnapshot)
  useEffect(() => bindPageLifecycle(pageSession, document, window, () => flushSync(() => lockSession()), () => flushSync(() => pageSession.suspend()), () => flushSync(() => pageSession.resume()), () => { void queryClient.invalidateQueries({ queryKey: ['config'] }) }), [])
  if (!config.data) return <main className="setup-screen"><div className="setup-panel"><Brand />{config.error ? <><ErrorNotice message={config.error.message} /><Button onClick={() => void config.refetch()}>重试连接</Button></> : <LoginSkeleton />}</div></main>
  // Keep the login form mounted while its system credential sheet is open so
  // cancellation retains the automatic-prompt guard and the password fallback.
  if (!config.data.configured || !config.data.authenticated || (config.data.requireEntryVerification && !pageSession.token)) return <SetupPage config={config.data} />
  if (pageSession.suspended) return <main className="setup-screen"><div className="setup-panel"><Brand /><LoginSkeleton /></div></main>
  return <PreferencesProvider key={config.data.instanceId} config={config.data} fallback={(error, retry) => <AppFrame>{error ? <div className="page-stack"><ErrorNotice message={error} /><Button variant="outline" onClick={retry}>重试</Button></div> : <RouteSkeleton />}</AppFrame>}><Shell /><Toaster position="top-center" richColors /></PreferencesProvider>
}
function Shell() {
  const { preferences } = useWorkspace()
  const pathname = useRouterState({ select: state => state.location.pathname })
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => { setOnline(true); void queryClient.invalidateQueries({ predicate: q => q.meta?.poll === true }) }, off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return <AppFrame pins={preferences.pins.length}><PwaUpdate /><StableRegion><PreferencesMigration /></StableRegion><StableRegion>{!online && <div className="mb-5"><ErrorNotice message="网络已断开" /></div>}</StableRegion><StableRegion phase={pathname}><Outlet /></StableRegion></AppFrame>
}
function AppFrame({ children, pins }: { children: ReactNode; pins?: number }) {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const current = navigation.find(item => item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)) ?? navigation[0]
  return <div className="app-shell"><aside className="desktop-sidebar"><Link to="/" replace aria-label="返回概览"><Brand /></Link><nav aria-label="主导航" className="desktop-nav">{navigation.map(item => <Link key={item.to} to={item.to} replace className="nav-item" data-active={current.to === item.to}><item.icon /><span>{item.label}</span>{item.to === '/accounts' && <span className="nav-count"><LoadingValue loading={pins === undefined}>{pins}</LoadingValue></span>}</Link>)}</nav><div className="sidebar-bottom"><Link className="nav-item" to="/settings/app"><Download /><span>安装应用</span></Link></div></aside>
    <div className="app-main"><main className="main-content">{children}</main></div><nav aria-label="移动导航" className="mobile-nav">{navigation.map(item => <Link key={item.to} to={item.to} replace data-active={current.to === item.to}><item.icon /><span>{item.label}</span></Link>)}</nav></div>
}

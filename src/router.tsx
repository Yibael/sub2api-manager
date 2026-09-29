import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Link } from '@tanstack/react-router'
import { Root } from '@/components/shell'
import { ErrorNotice } from '@/components/common'
import { Button } from '@/components/ui/button'

const root = createRootRoute({ component: Root, notFoundComponent: () => <div className="page-stack"><h1>页面不存在</h1><Button asChild><Link to="/">返回概览</Link></Button></div>, errorComponent: () => <div className="page-stack"><ErrorNotice message="页面暂时无法显示，请刷新后重试。" /><Button onClick={() => window.location.reload()}>重新加载</Button></div> })
const index = createRoute({ getParentRoute: () => root, path: '/', component: lazyRouteComponent(() => import('@/pages/dashboard'), 'DashboardPage') })
const accounts = createRoute({ getParentRoute: () => root, path: '/accounts', component: lazyRouteComponent(() => import('@/pages/accounts'), 'AccountsPage') })
const detail = createRoute({ getParentRoute: () => root, path: '/accounts/$id', component: lazyRouteComponent(() => import('@/pages/detail'), 'DetailPage') })
const statistics = createRoute({ getParentRoute: () => root, path: '/statistics', component: lazyRouteComponent(() => import('@/pages/statistics'), 'StatisticsPage') })
const settings = createRoute({ getParentRoute: () => root, path: '/settings', component: lazyRouteComponent(() => import('@/pages/settings'), 'SettingsPage') })
const connection = createRoute({ getParentRoute: () => root, path: '/settings/connection', component: lazyRouteComponent(() => import('@/pages/settings'), 'SettingsPage') })
const preferences = createRoute({ getParentRoute: () => root, path: '/settings/preferences', component: lazyRouteComponent(() => import('@/pages/settings'), 'SettingsPage') })
const appSettings = createRoute({ getParentRoute: () => root, path: '/settings/app', component: lazyRouteComponent(() => import('@/pages/settings'), 'SettingsPage') })
export const router = createRouter({ routeTree: root.addChildren([index, accounts, detail, statistics, settings, connection, preferences, appSettings]), scrollRestoration: true, defaultPreload: false })
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

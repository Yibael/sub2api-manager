import { Elysia } from 'elysia'
import { staticPlugin } from '@elysiajs/static'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { createApp } from './app'
import { Monitor } from './monitor'
import { createUpstream } from './upstream'
import { writeSettings } from './settings'
import { WorkspaceStore } from './workspace'
import { timezoneSchema } from '../shared/domain'

const serverUrl = process.env.SUB2API_URL ?? ''
const key = process.env.SUB2API_ADMIN_KEY ?? ''
const password = process.env.APP_PASSWORD ?? ''
const production = process.env.NODE_ENV === 'production'
const origin = process.env.APP_ORIGIN ?? (production ? 'http://localhost:3001' : 'http://localhost:5173')
if (serverUrl && key && password.length < 16) throw new Error('APP_PASSWORD 至少需要 16 个字符')
if (production && !origin.startsWith('https://')) throw new Error('生产环境 APP_ORIGIN 必须使用 HTTPS')
const settingsPath = resolve(process.env.DATA_DIR ?? '.data', 'intervals.json')
const timeZone = timezoneSchema.parse(process.env.SUB2API_TIMEZONE ?? 'UTC')
const workspace = await WorkspaceStore.open(resolve(process.env.DATA_DIR ?? '.data', 'workspace.json'), timeZone, createHash('sha256').update(`${serverUrl}|${key}`).digest('hex').slice(0, 20))
const intervals = workspace.snapshot().preferences.intervals
const upstream = serverUrl && key ? createUpstream(serverUrl, key, process.env.ALLOW_HTTP_UPSTREAM === 'true') : null
const monitor = upstream ? new Monitor(upstream, intervals, timeZone) : null
const app = new Elysia()
  .use(createApp({ monitor, password, origin, secureCookie: origin.startsWith('https://'), serverUrl,
    instanceId: workspace.id, workspace,
    instanceName: process.env.INSTANCE_NAME ?? '我的工作空间',
    saveIntervals: value => writeSettings(settingsPath, value) }))
if (production) {
  app.use(staticPlugin({ assets: 'dist', prefix: '/', alwaysStatic: true }))
  app.get('/*', ({ path, set }) => {
    if (path.startsWith('/api/') || /\.[\w]+$/.test(path)) { set.status = 404; return 'Not found' }
    set.headers['cache-control'] = 'no-cache'
    return Bun.file('dist/index.html')
  })
}
app.listen({ port: Number(process.env.PORT ?? 3001), hostname: process.env.HOST ?? '127.0.0.1' })
console.log(`Sub2api Manager listening on ${app.server?.url.origin} (${monitor ? 'configured' : 'setup required'})`)

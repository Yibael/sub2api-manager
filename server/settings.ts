import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { defaultIntervals, intervalsSchema, type Intervals } from '../shared/domain'

export async function readSettings(path: string): Promise<Intervals> {
  try { return intervalsSchema.parse(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaultIntervals }
    throw new Error('刷新配置文件无效，请检查 DATA_DIR/intervals.json')
  }
}
export async function writeSettings(path: string, value: Intervals) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${crypto.randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(temp, path)
}

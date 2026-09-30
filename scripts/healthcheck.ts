// This local endpoint reads configuration only; it never queries sub2api.
try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? '3001'}/api/config`, {
    signal: AbortSignal.timeout(3000),
  })
  const config = response.ok ? await response.json() as { configured?: boolean } : null
  if (config?.configured !== true) throw new Error('Application is not ready')
} catch {
  console.error('Application is not ready')
  process.exit(1)
}

export {}

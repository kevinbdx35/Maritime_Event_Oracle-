import { initProcessor, processRaw } from './processor.js'
import { setupWebhooks }             from './webhooks.js'
import { AISStreamConnector }        from './connectors/aisstream.js'
import { AISHubConnector }           from './connectors/aishub.js'
import type { AISConnector }         from './connectors/base.js'

const AISSTREAM_KEY = process.env['AISSTREAM_API_KEY']
const AISHUB_KEY    = process.env['AISHUB_API_KEY']
const DRAIN_TIMEOUT = 10_000  // max ms to wait for in-flight writes on shutdown

async function main(): Promise<void> {
  console.log('[ingestor] starting...')

  await initProcessor()
  setupWebhooks()

  const connectors: AISConnector[] = []

  if (AISSTREAM_KEY) {
    connectors.push(new AISStreamConnector(AISSTREAM_KEY))
  } else {
    console.warn('[ingestor] AISSTREAM_API_KEY not set — AISStream disabled')
  }

  if (AISHUB_KEY) {
    connectors.push(new AISHubConnector(AISHUB_KEY))
  } else {
    console.warn('[ingestor] AISHUB_API_KEY not set — AISHub disabled')
  }

  if (connectors.length === 0) {
    console.warn('[ingestor] no live sources configured — waiting (demo/replay mode)')
    await new Promise(() => {})
    return
  }

  // Track in-flight processRaw() calls so shutdown can drain them
  let inFlight = 0

  for (const connector of connectors) {
    connector.onMessage(async (msg) => {
      inFlight++
      try {
        await processRaw(msg)
      } catch (err) {
        console.warn(`[${connector.name}] processRaw error`, err)
      } finally {
        inFlight--
      }
    })
    connector.on('connect',    () => console.log(`[${connector.name}] connected`))
    connector.on('disconnect', () => console.log(`[${connector.name}] disconnected`))
    await connector.start()
  }

  console.log(`[ingestor] ${connectors.length} source(s) active: ${connectors.map(c => c.name).join(', ')}`)

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  let shuttingDown = false

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[ingestor] ${signal} received — stopping connectors`)
    connectors.forEach(c => c.stop())

    const deadline = Date.now() + DRAIN_TIMEOUT
    while (inFlight > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50))
    }
    if (inFlight > 0) {
      console.warn(`[ingestor] shutdown with ${inFlight} in-flight write(s) — exiting anyway`)
    } else {
      console.log('[ingestor] all writes flushed — exiting cleanly')
    }
    process.exit(0)
  }

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(console.error) })
  process.on('SIGINT',  () => { shutdown('SIGINT').catch(console.error) })

  await new Promise(() => {}) // keep alive
}

main().catch((err) => {
  console.error('[ingestor] fatal', err)
  process.exit(1)
})

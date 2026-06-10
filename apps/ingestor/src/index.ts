import { initProcessor, processRaw } from './processor.js'
import { setupWebhooks }             from './webhooks.js'
import { AISStreamConnector }        from './connectors/aisstream.js'
import { AISHubConnector }           from './connectors/aishub.js'
import type { AISConnector }         from './connectors/base.js'

const AISSTREAM_KEY = process.env['AISSTREAM_API_KEY']
const AISHUB_KEY    = process.env['AISHUB_API_KEY']

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
    console.warn('[ingestor] AISHUB_API_KEY not set — AISHub disabled (register free at https://www.aishub.net/join)')
  }

  if (connectors.length === 0) {
    console.warn('[ingestor] no live sources configured — waiting (demo/replay mode)')
    await new Promise(() => {})
    return
  }

  for (const connector of connectors) {
    connector.onMessage(async (msg) => {
      try { await processRaw(msg) } catch (err) {
        console.warn(`[${connector.name}] processRaw error`, err)
      }
    })
    connector.on('connect',    () => console.log(`[${connector.name}] connected`))
    connector.on('disconnect', () => console.log(`[${connector.name}] disconnected`))
    await connector.start()
  }

  console.log(`[ingestor] ${connectors.length} source(s) active: ${connectors.map(c => c.name).join(', ')}`)

  const shutdown = (): void => { connectors.forEach(c => c.stop()); process.exit(0) }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT',  shutdown)

  await new Promise(() => {}) // keep alive
}

main().catch((err) => {
  console.error('[ingestor] fatal', err)
  process.exit(1)
})

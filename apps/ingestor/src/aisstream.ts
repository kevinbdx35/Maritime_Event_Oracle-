import WebSocket from 'ws'
import { ROTTERDAM_BBOX } from '@maritime/core'
import { processRaw } from './processor.js'

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
const RECONNECT_DELAY_MS = 5_000

interface AISStreamSubscription {
  APIkey: string
  BoundingBoxes: [[number, number], [number, number]][]
  FilterMessageTypes: string[]
}

function buildSubscription(apiKey: string): AISStreamSubscription {
  return {
    APIkey: apiKey,
    BoundingBoxes: [[
      [ROTTERDAM_BBOX.minLat, ROTTERDAM_BBOX.minLon],
      [ROTTERDAM_BBOX.maxLat, ROTTERDAM_BBOX.maxLon],
    ]],
    FilterMessageTypes: ['PositionReport', 'ExtendedClassBPositionReport'],
  }
}

function normalizeAISStreamMessage(raw: unknown): unknown {
  // AISStream wraps messages in a metadata envelope
  const msg = raw as Record<string, unknown>
  const metadata = msg['MetaData'] as Record<string, unknown> | undefined
  const posReport = (msg['Message'] as Record<string, unknown>)?.['PositionReport'] as Record<string, unknown> | undefined
  if (!metadata || !posReport) return null

  return {
    t:        metadata['time_utc'] ?? new Date().toISOString(),
    mmsi:     String(metadata['MMSI'] ?? '').padStart(9, '0').slice(-9),
    name:     metadata['ShipName'] ?? undefined,
    lat:      posReport['Latitude'],
    lon:      posReport['Longitude'],
    sog:      posReport['Sog'],
    cog:      posReport['Cog'],
    heading:  posReport['TrueHeading'],
    status:   posReport['NavigationalStatus'],
    msgType:  posReport['MessageID'] ?? 1,
    source:   'aisstream',
  }
}

export function startAISStream(apiKey: string): void {
  let ws: WebSocket | null = null
  let alive = true

  function connect(): void {
    ws = new WebSocket(AISSTREAM_URL)

    ws.on('open', () => {
      console.log('[aisstream] connected')
      ws!.send(JSON.stringify(buildSubscription(apiKey)))
    })

    ws.on('message', async (data: Buffer) => {
      try {
        const raw = JSON.parse(data.toString())
        const normalized = normalizeAISStreamMessage(raw)
        if (normalized) await processRaw(normalized)
      } catch (err) {
        console.warn('[aisstream] parse error', err)
      }
    })

    ws.on('close', () => {
      if (!alive) return
      console.log(`[aisstream] disconnected, reconnecting in ${RECONNECT_DELAY_MS}ms`)
      setTimeout(connect, RECONNECT_DELAY_MS)
    })

    ws.on('error', (err) => {
      console.error('[aisstream] error', err.message)
    })
  }

  connect()

  process.on('SIGTERM', () => { alive = false; ws?.close() })
  process.on('SIGINT',  () => { alive = false; ws?.close() })
}

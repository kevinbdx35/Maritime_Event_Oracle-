import WebSocket from 'ws'
import type { AISMessage } from '@maritime/core'
import { AISConnector } from './base.js'

const AISSTREAM_URL     = 'wss://stream.aisstream.io/v0/stream'
const RECONNECT_BASE_MS = 2_000    // first retry in 2s
const RECONNECT_MAX_MS  = 60_000   // cap at 60s
const HEARTBEAT_MS      = 120_000  // force-reconnect if silent for 2 min

// Bounding boxes: Rotterdam + main French ports (Channel, Atlantic, Med)
const BOUNDING_BOXES = [
  // Rotterdam / North Sea
  [[51.75, 3.80], [52.05, 4.60]],
  // French Channel coast: Dunkerque, Calais, Le Havre, Rouen
  [[49.30, -0.20], [51.15, 2.50]],
  // French Atlantic: Nantes, Saint-Nazaire, La Rochelle, Bordeaux
  [[44.75, -2.40], [47.40, -0.40]],
  // Brittany + Cherbourg
  [[48.20, -4.70], [49.80, -1.50]],
  // Mediterranean: Marseille, Fos
  [[43.10, 4.70], [43.55, 5.50]],
] as [[number, number], [number, number]][]

export class AISStreamConnector extends AISConnector {
  readonly name = 'aisstream'
  private ws: WebSocket | null = null
  private alive = true
  private attempt = 0
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private lastMessageAt = 0

  constructor(private readonly apiKey: string) { super() }

  async start(): Promise<void> { this.connect() }

  stop(): void {
    this.alive = false
    this.clearHeartbeat()
    this.ws?.close()
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) { clearTimeout(this.heartbeatTimer); this.heartbeatTimer = null }
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat()
    this.lastMessageAt = Date.now()
    this.heartbeatTimer = setTimeout(() => {
      const silentSec = Math.round((Date.now() - this.lastMessageAt) / 1000)
      console.warn(`[aisstream] silent for ${silentSec}s — forcing reconnect`)
      this.ws?.terminate()  // hard close → triggers 'close' → scheduleReconnect
    }, HEARTBEAT_MS)
  }

  // ── Backoff ───────────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS)
    const delaySec = Math.round(delay / 1000)
    console.log(`[aisstream] reconnecting in ${delaySec}s (attempt ${this.attempt + 1})`)
    this.attempt++
    setTimeout(() => { if (this.alive) this.connect() }, delay)
  }

  // ── Connection ────────────────────────────────────────────────────────────

  private connect(): void {
    this.ws = new WebSocket(AISSTREAM_URL)

    this.ws.on('open', () => {
      this.attempt = 0  // reset backoff on successful connect
      this.resetHeartbeat()
      this.ws!.send(JSON.stringify({
        APIKey:             this.apiKey,
        BoundingBoxes:      BOUNDING_BOXES,
        FilterMessageTypes: ['PositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData'],
      }))
      this.emit('connect')
      console.log(`[aisstream] connected — watching ${BOUNDING_BOXES.length} zones`)
    })

    this.ws.on('message', (data: Buffer) => {
      this.resetHeartbeat()
      try {
        const raw = JSON.parse(data.toString())
        const msg = this.normalize(raw)
        if (msg) this.emitMessage(msg)
      } catch (err) {
        console.warn('[aisstream] parse error', err)
      }
    })

    this.ws.on('close', () => {
      this.clearHeartbeat()
      this.emit('disconnect')
      if (!this.alive) return
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      console.error('[aisstream] error', err.message)
      // 'close' will follow — scheduleReconnect called there
    })
  }

  // ── Normalise ─────────────────────────────────────────────────────────────

  private normalize(raw: unknown): AISMessage | null {
    const msg     = raw as Record<string, unknown>
    const meta    = msg['MetaData'] as Record<string, unknown> | undefined
    const msgBody = msg['Message']  as Record<string, unknown> | undefined
    if (!meta || !msgBody) return null

    const t    = this.parseTime(meta['time_utc'] as string | undefined)
    const mmsi = String(meta['MMSI'] ?? '').padStart(9, '0').slice(-9)

    // ShipStaticData
    const staticData = msgBody['ShipStaticData'] as Record<string, unknown> | undefined
    if (staticData) {
      const lat = meta['latitude']  as number | undefined
      const lon = meta['longitude'] as number | undefined
      if (!lat || !lon) return null
      const result: AISMessage = {
        t, mmsi,
        lat, lon, sog: 0, cog: 0,
        msgType: 5, source: 'aisstream',
      }
      const imo  = String(staticData['ImoNumber'] ?? '').replace(/^0+$/, '')
      const name = (staticData['Name'] as string | undefined)?.trim() || (meta['ShipName'] as string | undefined)
      const type = staticData['Type'] as number | undefined
      if (imo)  result.imo      = imo
      if (name) result.name     = name
      if (type !== undefined) result.shipType = type
      return result
    }

    // PositionReport / ExtendedClassBPositionReport
    const pos = (msgBody['PositionReport'] ?? msgBody['ExtendedClassBPositionReport']) as Record<string, unknown> | undefined
    if (!pos) return null

    const result: AISMessage = {
      t, mmsi,
      lat:     pos['Latitude']  as number,
      lon:     pos['Longitude'] as number,
      sog:     pos['Sog']       as number,
      cog:     pos['Cog']       as number,
      msgType: (pos['MessageID'] as number) ?? 1,
      source:  'aisstream',
    }
    const name    = meta['ShipName'] as string | undefined
    const heading = pos['TrueHeading']        as number | undefined
    const status  = pos['NavigationalStatus'] as number | undefined
    if (name)    result.name    = name
    if (heading !== undefined) result.heading = heading
    if (status  !== undefined) result.status  = status
    return result
  }

  private parseTime(rawTime: string | undefined): string {
    if (!rawTime) return new Date().toISOString()
    const s = rawTime.replace(' +0000 UTC', 'Z').replace(' UTC', 'Z').replace(' ', 'T')
    const trimmed = s.replace(/(\.\d{3})\d+Z/, '$1Z')
    const d = new Date(trimmed)
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  }
}

import type { ConnectorDescriptor } from './base.js'

export const descriptor: ConnectorDescriptor = {
  name:        'aisstream',
  envKey:      'AISSTREAM_API_KEY',
  description: 'Real-time WebSocket — coastal + near-shore coverage',
  transport:   'websocket',
}

export function create(apiKey: string): AISStreamConnector {
  return new AISStreamConnector(apiKey)
}

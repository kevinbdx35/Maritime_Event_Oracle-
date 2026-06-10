import WebSocket from 'ws'
import { ROTTERDAM_BBOX } from '@maritime/core'
import type { AISMessage } from '@maritime/core'
import { AISConnector } from './base.js'

const AISSTREAM_URL  = 'wss://stream.aisstream.io/v0/stream'
const RECONNECT_MS   = 5_000

export class AISStreamConnector extends AISConnector {
  readonly name = 'aisstream'
  private ws: WebSocket | null = null
  private alive = true

  constructor(private readonly apiKey: string) { super() }

  async start(): Promise<void> { this.connect() }

  stop(): void {
    this.alive = false
    this.ws?.close()
  }

  private connect(): void {
    this.ws = new WebSocket(AISSTREAM_URL)

    this.ws.on('open', () => {
      console.log('[aisstream] connected')
      this.ws!.send(JSON.stringify({
        APIKey: this.apiKey,
        BoundingBoxes: [[
          [ROTTERDAM_BBOX.minLat, ROTTERDAM_BBOX.minLon],
          [ROTTERDAM_BBOX.maxLat, ROTTERDAM_BBOX.maxLon],
        ]],
        FilterMessageTypes: ['PositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData'],
      }))
      this.emit('connect')
    })

    this.ws.on('message', (data: Buffer) => {
      try {
        const raw = JSON.parse(data.toString())
        const msg = this.normalize(raw)
        if (msg) this.emitMessage(msg)
      } catch (err) {
        console.warn('[aisstream] parse error', err)
      }
    })

    this.ws.on('close', () => {
      this.emit('disconnect')
      if (!this.alive) return
      console.log(`[aisstream] disconnected — reconnecting in ${RECONNECT_MS}ms`)
      setTimeout(() => this.connect(), RECONNECT_MS)
    })

    this.ws.on('error', (err) => console.error('[aisstream] error', err.message))
  }

  private normalize(raw: unknown): AISMessage | null {
    const msg    = raw as Record<string, unknown>
    const meta   = msg['MetaData'] as Record<string, unknown> | undefined
    const msgBody = msg['Message'] as Record<string, unknown> | undefined
    if (!meta || !msgBody) return null

    const t = this.parseTime(meta['time_utc'] as string | undefined)
    const mmsi = String(meta['MMSI'] ?? '').padStart(9, '0').slice(-9)

    // ShipStaticData — carry name/IMO/shipType, use last known position (sog=0)
    const staticData = msgBody['ShipStaticData'] as Record<string, unknown> | undefined
    if (staticData) {
      const lat = meta['latitude']  as number | undefined
      const lon = meta['longitude'] as number | undefined
      if (!lat || !lon) return null
      return {
        t, mmsi,
        imo:      String(staticData['ImoNumber'] ?? '').replace(/^0+$/, '') || undefined,
        name:     (staticData['Name'] as string | undefined)?.trim() || (meta['ShipName'] as string | undefined),
        shipType: staticData['Type'] as number | undefined,
        lat, lon, sog: 0, cog: 0,
        msgType: 5,
        source: 'aisstream',
      }
    }

    // PositionReport / ExtendedClassBPositionReport
    const pos = (msgBody['PositionReport'] ?? msgBody['ExtendedClassBPositionReport']) as Record<string, unknown> | undefined
    if (!pos) return null
    return {
      t, mmsi,
      name:    meta['ShipName'] as string | undefined,
      lat:     pos['Latitude']           as number,
      lon:     pos['Longitude']          as number,
      sog:     pos['Sog']                as number,
      cog:     pos['Cog']                as number,
      heading: pos['TrueHeading']        as number | undefined,
      status:  pos['NavigationalStatus'] as number | undefined,
      msgType: (pos['MessageID'] as number) ?? 1,
      source:  'aisstream',
    }
  }

  private parseTime(rawTime: string | undefined): string {
    if (!rawTime) return new Date().toISOString()
    // "2026-06-10 20:43:11.938164308 +0000 UTC" → ISO-8601
    const s = rawTime.replace(' +0000 UTC', 'Z').replace(' UTC', 'Z').replace(' ', 'T')
    const trimmed = s.replace(/(\.\d{3})\d+Z/, '$1Z')
    const d = new Date(trimmed)
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  }
}

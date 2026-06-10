import { ROTTERDAM_BBOX } from '@maritime/core'
import type { AISMessage } from '@maritime/core'
import { AISConnector } from './base.js'

// AISHub.net — free HTTP polling API (register at https://www.aishub.net/join)
// Recommended polling interval: 60 s (free tier)
const AISHUB_URL      = 'http://data.aishub.net/ws.php'
const POLL_INTERVAL_MS = 60_000

interface AISHubMeta   { ERROR: boolean; FOUND_ROWS: number }
interface AISHubVessel {
  MMSI: number; TIME: string
  LONGITUDE: number; LATITUDE: number
  COG: number; SOG: number
  HEADING?: number; NAVSTAT?: number
  IMO?: number; NAME?: string; TYPE?: number
}

export class AISHubConnector extends AISConnector {
  readonly name = 'aishub'
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(private readonly apiKey: string) { super() }

  async start(): Promise<void> {
    this.running = true
    await this.poll()                                     // immediate first poll
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
    this.emit('connect')
    console.log('[aishub] polling started (60 s interval)')
  }

  stop(): void {
    this.running = false
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.emit('disconnect', 'stopped')
  }

  private async poll(): Promise<void> {
    if (!this.running) return
    try {
      const url = new URL(AISHUB_URL)
      url.searchParams.set('username', this.apiKey)
      url.searchParams.set('format',   '1')
      url.searchParams.set('output',   'json')
      url.searchParams.set('compress', '0')
      url.searchParams.set('latmin',   String(ROTTERDAM_BBOX.minLat))
      url.searchParams.set('latmax',   String(ROTTERDAM_BBOX.maxLat))
      url.searchParams.set('lonmin',   String(ROTTERDAM_BBOX.minLon))
      url.searchParams.set('lonmax',   String(ROTTERDAM_BBOX.maxLon))

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) { console.warn(`[aishub] HTTP ${res.status}`); return }

      const data = await res.json() as [AISHubMeta, AISHubVessel[]]
      if (!Array.isArray(data) || data[0]?.ERROR) {
        console.warn('[aishub] API error:', data[0]); return
      }

      const vessels = data[1] ?? []
      let count = 0
      for (const v of vessels) {
        const msg = this.normalize(v)
        if (msg) { this.emitMessage(msg); count++ }
      }
      console.log(`[aishub] polled ${count}/${vessels.length} vessels in bbox`)
    } catch (err) {
      console.warn('[aishub] poll error', (err as Error).message)
    }
  }

  private normalize(v: AISHubVessel): AISMessage | null {
    if (!v.MMSI || v.LATITUDE === undefined || v.LONGITUDE === undefined) return null

    // TIME format: "2024-03-15 07:35:00 UTC"  →  ISO-8601
    const t = v.TIME
      ? new Date(v.TIME.replace(' UTC', 'Z')).toISOString()
      : new Date().toISOString()

    return {
      t,
      mmsi:     String(v.MMSI).padStart(9, '0').slice(-9),
      imo:      v.IMO && v.IMO > 0 ? String(v.IMO) : undefined,
      name:     v.NAME?.trim() || undefined,
      lat:      v.LATITUDE,
      lon:      v.LONGITUDE,
      sog:      v.SOG   ?? 0,
      cog:      v.COG   ?? 0,
      heading:  v.HEADING,
      status:   v.NAVSTAT,
      msgType:  1,           // Class A position report equivalent
      source:   'aishub',
    }
  }
}

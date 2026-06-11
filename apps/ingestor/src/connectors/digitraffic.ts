import type { AISMessage } from '@maritime/core'
import { AISConnector } from './base.js'

// Digitraffic Marine — Finnish Transport Infrastructure Agency (Fintraffic)
// Fully open data (CC BY 4.0), no API key. Clients identify themselves with a
// `Digitraffic-User` header — we reuse that value as the registry activation key.
// Docs: https://www.digitraffic.fi/en/marine-traffic/
const LOCATIONS_URL    = 'https://meri.digitraffic.fi/api/ais/v1/locations'
const VESSELS_URL      = 'https://meri.digitraffic.fi/api/ais/v1/vessels'
const POLL_INTERVAL_MS = 30_000        // open data, generous rate limits
const META_REFRESH_MS  = 10 * 60_000   // vessel name/IMO cache refresh
const POLL_OVERLAP_MS  = 5_000         // re-fetch margin between polls
const MAX_AGE_MS       = 15 * 60_000   // initial snapshot includes years-old "last
                                       // known" positions — drop anything stale

// Gulf of Finland — Helsinki + Tallinn approaches. Overlaps aisstream's Baltic
// zone so the consensus gate sees the same vessels from ≥2 sources.
const GULF_OF_FINLAND_BBOX = {
  minLat: 59.20, maxLat: 60.50,
  minLon: 23.50, maxLon: 27.50,
} as const

interface DTLocationFeature {
  mmsi: number
  geometry?: { coordinates?: [number, number] }
  properties?: {
    sog?: number; cog?: number
    navStat?: number; heading?: number
    timestampExternal?: number
  }
}

interface DTVessel {
  mmsi: number
  name?: string
  imo?: number
  shipType?: number
}

interface VesselMeta { name?: string; imo?: string; shipType?: number }

export class DigitrafficConnector extends AISConnector {
  readonly name = 'digitraffic'
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private metaTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastPollAt = 0   // epoch ms of last successful poll (0 = full snapshot)
  private meta = new Map<string, VesselMeta>()

  constructor(private readonly user: string) { super() }

  async start(): Promise<void> {
    this.running = true
    await this.refreshMetadata()                          // names/IMO before first positions
    await this.poll()                                     // immediate full snapshot
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
    this.metaTimer = setInterval(() => this.refreshMetadata(), META_REFRESH_MS)
    this.emit('connect')
    console.log('[digitraffic] polling started (30 s interval, Gulf of Finland)')
  }

  stop(): void {
    this.running = false
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.metaTimer) { clearInterval(this.metaTimer); this.metaTimer = null }
    this.emit('disconnect', 'stopped')
  }

  // ── Fetch helpers ─────────────────────────────────────────────────────────

  private async fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url, {
      // gzip is mandatory on this API; node fetch decompresses transparently
      headers: { 'Digitraffic-User': this.user, 'Accept-Encoding': 'gzip' },
      signal:  AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  // ── Vessel metadata cache (names, IMO, ship type) ─────────────────────────

  private async refreshMetadata(): Promise<void> {
    if (!this.running) return
    try {
      const vessels = await this.fetchJson(VESSELS_URL) as DTVessel[]
      if (!Array.isArray(vessels)) return
      for (const v of vessels) {
        if (!v.mmsi) continue
        const entry: VesselMeta = {}
        const name = v.name?.trim()
        if (name) entry.name = name
        if (v.imo && v.imo > 0) entry.imo = String(v.imo)
        if (v.shipType !== undefined) entry.shipType = v.shipType
        this.meta.set(String(v.mmsi).padStart(9, '0').slice(-9), entry)
      }
      console.log(`[digitraffic] metadata cache: ${this.meta.size} vessels`)
    } catch (err) {
      console.warn('[digitraffic] metadata refresh error', (err as Error).message)
    }
  }

  // ── Position polling ──────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.running) return
    const pollStartedAt = Date.now()
    try {
      const url = new URL(LOCATIONS_URL)
      if (this.lastPollAt > 0) {
        url.searchParams.set('from', String(this.lastPollAt - POLL_OVERLAP_MS))
      }

      const data = await this.fetchJson(url.toString()) as { features?: DTLocationFeature[] }
      const features = data.features ?? []

      let count = 0
      for (const f of features) {
        const msg = this.normalize(f)
        if (msg) { this.emitMessage(msg); count++ }
      }
      this.lastPollAt = pollStartedAt
      console.log(`[digitraffic] polled ${count}/${features.length} positions in bbox`)
    } catch (err) {
      console.warn('[digitraffic] poll error', (err as Error).message)
    }
  }

  // ── Normalise ─────────────────────────────────────────────────────────────

  private normalize(f: DTLocationFeature): AISMessage | null {
    const [lon, lat] = f.geometry?.coordinates ?? []
    if (!f.mmsi || lat === undefined || lon === undefined) return null

    const b = GULF_OF_FINLAND_BBOX
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return null

    const p = f.properties ?? {}
    if (p.timestampExternal !== undefined && Date.now() - p.timestampExternal > MAX_AGE_MS) return null

    const mmsi = String(f.mmsi).padStart(9, '0').slice(-9)
    const sog  = p.sog !== undefined && p.sog >= 0 && p.sog <= 102.2 ? p.sog : 0
    const cog  = p.cog !== undefined && p.cog >= 0 && p.cog <= 360   ? p.cog : 0

    const result: AISMessage = {
      t: new Date(p.timestampExternal ?? Date.now()).toISOString(),
      mmsi,
      lat, lon, sog, cog,
      msgType: 1,
      source:  'digitraffic',
    }
    if (p.heading !== undefined && p.heading >= 0 && p.heading <= 511) result.heading = p.heading
    if (p.navStat !== undefined && p.navStat >= 0 && p.navStat <= 15) result.status = p.navStat

    const meta = this.meta.get(mmsi)
    if (meta?.name) result.name = meta.name
    if (meta?.imo)  result.imo  = meta.imo
    if (meta?.shipType !== undefined) result.shipType = meta.shipType
    return result
  }
}

import type { ConnectorDescriptor } from './base.js'

export const descriptor: ConnectorDescriptor = {
  name:        'digitraffic',
  envKey:      'DIGITRAFFIC_USER',
  description: 'Open data, Baltic/Finland — no key, set any app name to enable',
  transport:   'http-poll',
}

export function create(user: string): DigitrafficConnector {
  return new DigitrafficConnector(user)
}

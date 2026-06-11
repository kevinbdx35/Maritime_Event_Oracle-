// @ts-ignore — @turf/distance types not exported in package.json "exports" for NodeNext; works at runtime
import distance from '@turf/distance'
// @ts-ignore
import { point } from '@turf/helpers'
import { signEvent } from '@maritime/core'
import type { VoyageSummary } from '@maritime/core'
import { query } from './db/client.js'
import { upsertVoyage } from './db/repository.js'

const SIGNING_KEY = process.env['EVT_SIGNING_KEY'] ?? ''

interface OpenVoyage {
  id: string
  arrivalEventId: string
  arrivalTime: Date
  mmsi: string
  port: string
  imo?: string
  name?: string
}

// In-memory registry of open (arrived, not yet departed) voyages per MMSI
const openVoyages = new Map<string, OpenVoyage>()

let _voySeq = 0
function nextVoyId(): string {
  const ts  = Date.now().toString(16).padStart(12, '0')
  const rnd = Math.random().toString(16).slice(2, 8)
  return `voy_${ts}${(++_voySeq).toString(16).padStart(4, '0')}${rnd}`
}

export async function openVoyage(params: {
  mmsi: string; imo?: string; name?: string
  arrivalEventId: string; arrivalTime: Date; port?: string
}): Promise<void> {
  const id = nextVoyId()
  const port = params.port ?? 'NLRTM'
  const entry: OpenVoyage = { id, arrivalEventId: params.arrivalEventId, arrivalTime: params.arrivalTime, mmsi: params.mmsi, port }
  if (params.imo  !== undefined) entry.imo  = params.imo
  if (params.name !== undefined) entry.name = params.name
  openVoyages.set(params.mmsi, entry)

  await query(
    `INSERT INTO voyages (id, mmsi, imo, vessel_name, port, arrival_event_id, period_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO NOTHING`,
    [id, params.mmsi, params.imo ?? null, params.name ?? null, port,
     params.arrivalEventId, params.arrivalTime],
  )
}

export async function closeVoyage(params: {
  mmsi: string; imo?: string; name?: string
  departureEventId: string; departureTime: Date
}): Promise<void> {
  const open = openVoyages.get(params.mmsi)
  if (!open) return   // no open voyage — vessel departed before we tracked arrival

  openVoyages.delete(params.mmsi)

  // Fetch positions in the port-call window
  const positions = await query<{ lat: number; lon: number; sog: number; time: Date }>(
    `SELECT lat, lon, sog, time FROM positions
     WHERE mmsi = $1 AND time >= $2 AND time <= $3
     ORDER BY time ASC`,
    [params.mmsi, open.arrivalTime, params.departureTime],
  )
  const pts = positions.rows

  // Geodesic distance (nm)
  let distanceNm = 0
  for (let i = 1; i < pts.length; i++) {
    const a = point([pts[i-1]!.lon, pts[i-1]!.lat])
    const b = point([pts[i]!.lon, pts[i]!.lat])
    distanceNm += distance(a, b, { units: 'nauticalmiles' })
  }

  // Speed profile
  const speeds = pts.map(p => p.sog).sort((a, b) => a - b)
  const p50 = speeds[Math.floor(speeds.length * 0.50)] ?? 0
  const p95 = speeds[Math.floor(speeds.length * 0.95)] ?? 0

  // Time breakdown (hours)
  const totalMs = params.departureTime.getTime() - open.arrivalTime.getTime()
  const totalHours = totalMs / 3_600_000
  const mooredHours   = pts.filter(p => p.sog < 0.5).length  / Math.max(pts.length, 1) * totalHours
  const anchoredHours = pts.filter(p => p.sog < 1.5 && p.sog >= 0.5).length / Math.max(pts.length, 1) * totalHours
  const underwayHours = totalHours - mooredHours - anchoredHours

  const voyage: VoyageSummary = {
    id:                 open.id,
    schema:             'voyage-summary/v1',
    vessel:             Object.assign({ mmsi: params.mmsi },
                          params.imo  !== undefined ? { imo:  params.imo  } : {},
                          params.name !== undefined ? { name: params.name } : {}),
    port:               open.port,
    arrival_event_id:   open.arrivalEventId,
    departure_event_id: params.departureEventId,
    period:             { from: open.arrivalTime.toISOString(), to: params.departureTime.toISOString() },
    distance_nm:        Math.round(distanceNm * 10) / 10,
    speed_profile:      { p50_knots: Math.round(p50 * 10)/10, p95_knots: Math.round(p95 * 10)/10, samples: speeds.length },
    time_breakdown:     {
      total_hours:    Math.round(totalHours * 10) / 10,
      underway_hours: Math.round(underwayHours * 10) / 10,
      anchored_hours: Math.round(anchoredHours * 10) / 10,
      moored_hours:   Math.round(mooredHours * 10) / 10,
    },
    signature: '',
    anchor:    null,
  }

  const { signature: _, ...toSign } = voyage
  voyage.signature = SIGNING_KEY ? signEvent(toSign, SIGNING_KEY) : 'ed25519:unsigned'

  await upsertVoyage(voyage)
  console.log(`[voyage] ${open.id} closed — ${Math.round(totalHours)}h, ${voyage.distance_nm} nm`)
}

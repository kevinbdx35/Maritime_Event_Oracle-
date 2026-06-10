/**
 * seed-db.ts — Replay rotterdam-scenario.ndjson into the real database.
 * Lets the dashboard show live events while the AISStream key is being activated.
 *
 * Usage: pnpm seed-db
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pg from 'pg'
import {
  AISMessageSchema,
  VesselStateMachine,
  computeConfidence,
  signEvent,
  EVENT_SCHEMA_VERSION,
} from '@maritime/core'
import type { PositionRecord, MaritimeEvent } from '@maritime/core'

const __dir = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dir, '../fixtures/rotterdam-scenario.ndjson')

const pool = new pg.Pool({
  host:     process.env['DB_HOST']     ?? 'localhost',
  port:     parseInt(process.env['DB_PORT'] ?? '5432'),
  database: process.env['DB_NAME']     ?? 'maritime',
  user:     process.env['DB_USER']     ?? 'maritime',
  password: process.env['DB_PASSWORD'] ?? 'maritime_dev',
})

const SIGNING_KEY = process.env['EVT_SIGNING_KEY'] ?? ''

async function main(): Promise<void> {
  const lines = readFileSync(FIXTURE, 'utf8').trim().split('\n')
  const messages = lines.map(l => AISMessageSchema.parse(JSON.parse(l)))

  const machine = new VesselStateMachine(messages[0]!.mmsi)
  const trackingSince = new Date(messages[0]!.t)
  let seq = 0
  function nextId(): string {
    const ts  = Date.now().toString(16).padStart(12, '0')
    const rnd = Math.random().toString(16).slice(2, 10)
    return `evt_${ts}${(++seq).toString(16).padStart(4, '0')}${rnd}`
  }

  const events: MaritimeEvent[] = []

  for (const msg of messages) {
    const time = new Date(msg.t)
    const pos: PositionRecord = {
      mmsi: msg.mmsi, time, lat: msg.lat, lon: msg.lon,
      sog: msg.sog, cog: msg.cog, heading: msg.heading, source: msg.source,
    }

    await pool.query(
      `INSERT INTO vessels (mmsi, imo, name, first_seen, last_seen)
       VALUES ($1,$2,$3,now(),now())
       ON CONFLICT (mmsi) DO UPDATE SET last_seen=now()`,
      [msg.mmsi, msg.imo ?? null, msg.name ?? null],
    )
    await pool.query(
      `INSERT INTO positions (time, mmsi, lat, lon, sog, cog, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [time, msg.mmsi, msg.lat, msg.lon, msg.sog, msg.cog, msg.source],
    )

    const transition = machine.update(pos)
    if (!transition) continue

    const ageMin = (time.getTime() - trackingSince.getTime()) / 60_000
    const bd = computeConfidence({
      windowPositions: transition.positions,
      trackingAgeMinutes: ageMin,
      source: msg.source,
      corroborationSources: [msg.source],
    })

    const evt: MaritimeEvent = {
      id: nextId(),
      schema: EVENT_SCHEMA_VERSION,
      vessel: { mmsi: msg.mmsi, imo: msg.imo, name: msg.name },
      event:  transition.eventType,
      port:   'NLRTM',
      timestamp: transition.timestamp.toISOString(),
      confidence: bd.weighted_score,
      confidence_breakdown: bd,
      evidence: {
        positions_window: transition.positions.map(p => ({
          time: p.time.toISOString(), lat: p.lat, lon: p.lon, sog: p.sog, cog: p.cog,
        })),
        sources: [msg.source],
        corroboration_sources: [msg.source],
        window_start: transition.positions[0]?.time.toISOString() ?? transition.timestamp.toISOString(),
        window_end:   transition.positions.at(-1)?.time.toISOString() ?? transition.timestamp.toISOString(),
        message_count: transition.positions.length,
      },
      signature: '',
      anchor: null,
    }
    const { signature: _, ...toSign } = evt
    evt.signature = SIGNING_KEY ? signEvent(toSign, SIGNING_KEY) : 'ed25519:unsigned'

    await pool.query(
      `INSERT INTO events
         (id, schema_version, mmsi, imo, vessel_name, event_type, port,
          timestamp, confidence, confidence_breakdown, evidence, signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        evt.id, evt.schema, evt.vessel.mmsi, evt.vessel.imo ?? null,
        evt.vessel.name ?? null, evt.event, evt.port, evt.timestamp,
        evt.confidence, JSON.stringify(evt.confidence_breakdown),
        JSON.stringify(evt.evidence), evt.signature,
      ],
    )
    events.push(evt)
    console.log(`  ✓ ${evt.event.padEnd(18)} conf=${evt.confidence.toFixed(1)}  ${evt.timestamp}`)
  }

  console.log(`\n[seed] inserted ${events.length} events into DB`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })

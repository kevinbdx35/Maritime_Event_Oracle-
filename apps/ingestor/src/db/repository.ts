import { query } from './client.js'
import type { MaritimeEvent, VoyageSummary } from '@maritime/core'
import type { VesselState, PositionRecord } from '@maritime/core'

export async function upsertVessel(
  mmsi: string, imo?: string, name?: string, shipType?: number, flagState?: string
): Promise<void> {
  await query(
    `INSERT INTO vessels (mmsi, imo, name, ship_type, flag_state, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (mmsi) DO UPDATE SET
       imo        = COALESCE($2, vessels.imo),
       name       = COALESCE($3, vessels.name),
       ship_type  = COALESCE($4, vessels.ship_type),
       flag_state = COALESCE($5, vessels.flag_state),
       last_seen  = now()`,
    [mmsi, imo ?? null, name ?? null, shipType ?? null, flagState ?? null],
  )
}

export async function insertPosition(pos: PositionRecord): Promise<void> {
  await query(
    `INSERT INTO positions (time, mmsi, lat, lon, sog, cog, heading, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [pos.time, pos.mmsi, pos.lat, pos.lon, pos.sog, pos.cog, pos.heading ?? null, pos.source],
  )
}

export async function insertEvent(evt: MaritimeEvent): Promise<void> {
  await query(
    `INSERT INTO events (
       id, schema_version, mmsi, imo, vessel_name, event_type, port,
       timestamp, confidence, confidence_breakdown, evidence, signature,
       gap_meta, corrects
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO NOTHING`,
    [
      evt.id, evt.schema, evt.vessel.mmsi, evt.vessel.imo ?? null,
      evt.vessel.name ?? null, evt.event, evt.port,
      evt.timestamp, evt.confidence,
      JSON.stringify(evt.confidence_breakdown),
      JSON.stringify(evt.evidence),
      evt.signature,
      evt.gap ? JSON.stringify(evt.gap) : null,
      evt.corrects ?? null,
    ],
  )
}

export async function saveVesselState(mmsi: string, state: VesselState, trackingSince?: Date): Promise<void> {
  await query(
    `INSERT INTO vessel_states (mmsi, state, updated_at, tracking_since)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (mmsi) DO UPDATE SET state = $2, updated_at = now(),
       tracking_since = COALESCE($3, vessel_states.tracking_since)`,
    [mmsi, state, trackingSince ?? null],
  )
}

export async function loadVesselStates(): Promise<Map<string, { state: VesselState; trackingSinceMinutes: number }>> {
  const result = await query<{ mmsi: string; state: string; tracking_since: Date | null }>(
    `SELECT mmsi, state, tracking_since FROM vessel_states WHERE updated_at > now() - interval '48 hours'`
  )
  const map = new Map<string, { state: VesselState; trackingSinceMinutes: number }>()
  for (const row of result.rows) {
    const age = row.tracking_since
      ? (Date.now() - row.tracking_since.getTime()) / 60_000
      : 0
    map.set(row.mmsi, { state: row.state as VesselState, trackingSinceMinutes: age })
  }
  return map
}

export async function updateEventAnchor(
  eventId: string,
  batchId: string,
  proof: string[],
): Promise<void> {
  await query(
    `UPDATE events SET anchor_batch_id = $1, merkle_proof = $2 WHERE id = $3`,
    [batchId, proof, eventId],
  )
}

export async function upsertVoyage(voyage: VoyageSummary): Promise<void> {
  await query(
    `INSERT INTO voyages (id, mmsi, imo, vessel_name, port, arrival_event_id, departure_event_id,
       period_from, period_to, summary, signature)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
       summary = $10, signature = $11, period_to = $9`,
    [
      voyage.id, voyage.vessel.mmsi, voyage.vessel.imo ?? null,
      voyage.vessel.name ?? null, voyage.port,
      voyage.arrival_event_id, voyage.departure_event_id,
      voyage.period.from, voyage.period.to,
      JSON.stringify(voyage), voyage.signature,
    ],
  )
}

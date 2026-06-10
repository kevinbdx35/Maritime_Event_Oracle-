import { describe, it, expect, beforeEach } from 'vitest'
import { VesselStateMachine } from '../src/detection/state-machine.js'
import { VesselState } from '../src/types/vessel.js'
import type { PositionRecord } from '../src/types/vessel.js'

function pos(
  mmsi: string,
  isoTime: string,
  lat: number,
  lon: number,
  sog: number,
): PositionRecord {
  return { mmsi, time: new Date(isoTime), lat, lon, sog, cog: 0, source: 'test' }
}

// Coordinates firmly inside the Rotterdam port polygon (Maasvlakte corridor)
const PORT_LAT  = 51.900
const PORT_LON  = 4.300
// Coordinates in the Maasanker North anchorage
const ANCH_LAT  = 51.990
const ANCH_LON  = 3.870
// Coordinates outside (North Sea approach)
const SEA_LAT   = 51.830
const SEA_LON   = 3.500

describe('VesselStateMachine', () => {
  let fsm: VesselStateMachine

  beforeEach(() => {
    fsm = new VesselStateMachine('244820000')
  })

  it('starts in UNKNOWN state', () => {
    expect(fsm.currentState).toBe(VesselState.UNKNOWN)
  })

  it('emits PORT_ARRIVAL after 20+ min of slow speed in port polygon', () => {
    // Feed 6 positions over 25 minutes at slow speed inside port
    const positions = [
      pos('244820000', '2024-03-15T07:10:00Z', PORT_LAT, PORT_LON, 0.8),
      pos('244820000', '2024-03-15T07:15:00Z', PORT_LAT, PORT_LON, 0.6),
      pos('244820000', '2024-03-15T07:20:00Z', PORT_LAT, PORT_LON, 0.4),
      pos('244820000', '2024-03-15T07:25:00Z', PORT_LAT, PORT_LON, 0.3),
      pos('244820000', '2024-03-15T07:30:00Z', PORT_LAT, PORT_LON, 0.2),
      pos('244820000', '2024-03-15T07:35:00Z', PORT_LAT, PORT_LON, 0.1),
    ]

    let arrival: ReturnType<typeof fsm.update> = null
    for (const p of positions) {
      const t = fsm.update(p)
      if (t) arrival = t
    }

    expect(arrival).not.toBeNull()
    expect(arrival!.eventType).toBe('PORT_ARRIVAL')
    expect(arrival!.toState).toBe(VesselState.MOORED)
  })

  it('does NOT emit PORT_ARRIVAL if speed stays above threshold', () => {
    const positions = [
      pos('244820000', '2024-03-15T07:10:00Z', PORT_LAT, PORT_LON, 3.5),
      pos('244820000', '2024-03-15T07:20:00Z', PORT_LAT, PORT_LON, 3.2),
      pos('244820000', '2024-03-15T07:30:00Z', PORT_LAT, PORT_LON, 3.8),
      pos('244820000', '2024-03-15T07:40:00Z', PORT_LAT, PORT_LON, 4.1),
    ]

    let anyTransition = false
    for (const p of positions) {
      if (fsm.update(p)) anyTransition = true
    }

    expect(anyTransition).toBe(false)
    expect(fsm.currentState).not.toBe(VesselState.MOORED)
  })

  it('emits PORT_DEPARTURE after 10+ min of fast speed outside port', () => {
    // First arrive
    const arrivalPositions = [
      pos('244820000', '2024-03-15T07:10:00Z', PORT_LAT, PORT_LON, 0.8),
      pos('244820000', '2024-03-15T07:15:00Z', PORT_LAT, PORT_LON, 0.6),
      pos('244820000', '2024-03-15T07:20:00Z', PORT_LAT, PORT_LON, 0.4),
      pos('244820000', '2024-03-15T07:25:00Z', PORT_LAT, PORT_LON, 0.3),
      pos('244820000', '2024-03-15T07:30:00Z', PORT_LAT, PORT_LON, 0.2),
      pos('244820000', '2024-03-15T07:35:00Z', PORT_LAT, PORT_LON, 0.1),
    ]
    for (const p of arrivalPositions) fsm.update(p)
    expect(fsm.currentState).toBe(VesselState.MOORED)

    // Now depart
    const departurePositions = [
      pos('244820000', '2024-03-15T12:50:00Z', SEA_LAT + 0.15, SEA_LON + 0.6, 5.0),
      pos('244820000', '2024-03-15T12:55:00Z', SEA_LAT + 0.13, SEA_LON + 0.55, 6.0),
      pos('244820000', '2024-03-15T13:00:00Z', SEA_LAT + 0.11, SEA_LON + 0.5, 7.5),
      pos('244820000', '2024-03-15T13:05:00Z', SEA_LAT + 0.09, SEA_LON + 0.45, 9.0),
      pos('244820000', '2024-03-15T13:10:00Z', SEA_LAT + 0.07, SEA_LON + 0.4, 10.2),
      pos('244820000', '2024-03-15T13:15:00Z', SEA_LAT + 0.05, SEA_LON + 0.35, 11.5),
    ]

    let departure: ReturnType<typeof fsm.update> = null
    for (const p of departurePositions) {
      const t = fsm.update(p)
      if (t) departure = t
    }

    expect(departure).not.toBeNull()
    expect(departure!.eventType).toBe('PORT_DEPARTURE')
    expect(departure!.toState).toBe(VesselState.DEPARTED)
  })

  it('emits ANCHORAGE_START when slow in anchorage zone', () => {
    const positions = [
      pos('244820000', '2024-03-15T07:00:00Z', ANCH_LAT, ANCH_LON, 0.4),
      pos('244820000', '2024-03-15T07:05:00Z', ANCH_LAT, ANCH_LON, 0.3),
      pos('244820000', '2024-03-15T07:10:00Z', ANCH_LAT, ANCH_LON, 0.2),
      pos('244820000', '2024-03-15T07:15:00Z', ANCH_LAT, ANCH_LON, 0.2),
      pos('244820000', '2024-03-15T07:20:00Z', ANCH_LAT, ANCH_LON, 0.1),
      pos('244820000', '2024-03-15T07:25:00Z', ANCH_LAT, ANCH_LON, 0.1),
    ]

    let anchorStart: ReturnType<typeof fsm.update> = null
    for (const p of positions) {
      const t = fsm.update(p)
      if (t?.eventType === 'ANCHORAGE_START') anchorStart = t
    }

    expect(anchorStart).not.toBeNull()
    expect(anchorStart!.toState).toBe(VesselState.ANCHORED)
  })

  it('evidence window contains only positions in the detection window', () => {
    const positions = [
      pos('244820000', '2024-03-15T07:10:00Z', PORT_LAT, PORT_LON, 0.8),
      pos('244820000', '2024-03-15T07:15:00Z', PORT_LAT, PORT_LON, 0.6),
      pos('244820000', '2024-03-15T07:20:00Z', PORT_LAT, PORT_LON, 0.4),
      pos('244820000', '2024-03-15T07:25:00Z', PORT_LAT, PORT_LON, 0.3),
      pos('244820000', '2024-03-15T07:30:00Z', PORT_LAT, PORT_LON, 0.2),
      pos('244820000', '2024-03-15T07:35:00Z', PORT_LAT, PORT_LON, 0.1),
    ]

    let transition: ReturnType<typeof fsm.update> = null
    for (const p of positions) {
      const t = fsm.update(p)
      if (t) transition = t
    }

    expect(transition!.positions.length).toBeGreaterThanOrEqual(2)
    for (const p of transition!.positions) {
      expect(p.sog).toBeLessThan(1.0)
    }
  })
})

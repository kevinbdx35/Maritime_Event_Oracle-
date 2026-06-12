import { describe, it, expect, beforeEach } from 'vitest'
import { StsDetector } from '../src/detection/sts-detector.js'
import type { PositionRecord } from '../src/types/vessel.js'

// Coordinates outside all zones (North Sea approach) — from state-machine tests
const SEA_LAT = 51.830
const SEA_LON = 3.500
// Inside the Rotterdam port polygon
const PORT_LAT = 51.900
const PORT_LON = 4.300
// Inside the Maasanker North anchorage
const ANCH_LAT = 51.990
const ANCH_LON = 3.870

// ~0.0015° latitude ≈ 167 m
const NEARBY = 0.0015

const T0 = new Date('2026-06-12T10:00:00Z').getTime()
const min = (n: number) => new Date(T0 + n * 60_000)

function pos(mmsi: string, time: Date, lat: number, lon: number, sog = 0.2): PositionRecord {
  return { mmsi, time, lat, lon, sog, cog: 0, source: 'test' }
}

// Tanker — eligible ship type for STS pairing
const TANKER = 80

describe('StsDetector', () => {
  let det: StsDetector
  beforeEach(() => { det = new StsDetector() })

  // Feed both vessels every 5 min (stays under the 10-min staleness TTL).
  // null ship type means "never known" (undefined would trigger the default)
  function runPair(latA: number, lonA: number, latB: number, lonB: number, minutes: number, typeA: number | null = TANKER, typeB: number | null = TANKER, fromMin = 0) {
    const all = []
    for (let m = fromMin; m <= fromMin + minutes; m += 5) {
      all.push(...det.update(pos('111111111', min(m), latA, lonA), typeA ?? undefined))
      all.push(...det.update(pos('222222222', min(m), latB, lonB), typeB ?? undefined))
    }
    return all
  }

  it('detects two vessels stationary side by side at sea for 30+ minutes', () => {
    const hits = runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 35)
    expect(hits).toHaveLength(1)
    const sts = hits[0]!
    expect([sts.mmsi, sts.partnerMmsi].sort()).toEqual(['111111111', '222222222'])
    expect(sts.durationMinutes).toBeGreaterThanOrEqual(30)
    expect(sts.distanceM).toBeLessThan(300)
    expect(sts.inAnchorage).toBe(false)
  })

  it('reports each pair episode only once', () => {
    runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 35)
    const more = runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 60)
    expect(more).toHaveLength(0)
  })

  it('does not fire before 30 minutes together', () => {
    const hits = runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 25)
    expect(hits).toHaveLength(0)
  })

  it('ignores vessels berthed inside a port zone', () => {
    const hits = runPair(PORT_LAT, PORT_LON, PORT_LAT + NEARBY, PORT_LON, 60)
    expect(hits).toHaveLength(0)
  })

  it('flags in_anchorage when the rendezvous happens in an anchorage', () => {
    const hits = runPair(ANCH_LAT, ANCH_LON, ANCH_LAT + NEARBY, ANCH_LON, 35)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.inAnchorage).toBe(true)
  })

  it('resets the pair when one vessel gets underway', () => {
    runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 20)
    // vessel B sails off at t+25
    det.update(pos('222222222', min(25), SEA_LAT + NEARBY, SEA_LON, 8.0), TANKER)
    // both stationary again — episode must restart from zero
    const hits = []
    for (let m = 30; m <= 50; m += 5) {
      hits.push(...det.update(pos('111111111', min(m), SEA_LAT, SEA_LON), TANKER))
      hits.push(...det.update(pos('222222222', min(m), SEA_LAT + NEARBY, SEA_LON), TANKER))
    }
    expect(hits).toHaveLength(0)
  })

  it('ignores vessels far apart', () => {
    // ~1.1 km apart
    const hits = runPair(SEA_LAT, SEA_LON, SEA_LAT + 0.01, SEA_LON, 60)
    expect(hits).toHaveLength(0)
  })

  it('ignores ineligible ship types (tug rafted to a tanker)', () => {
    const hits = runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 60, 52, TANKER)
    expect(hits).toHaveLength(0)
  })

  it('ignores vessels whose ship type is unknown', () => {
    const hits = runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 60, null, TANKER)
    expect(hits).toHaveLength(0)
  })

  it('remembers a ship type seen earlier in the episode', () => {
    // type arrives on the first fix only (static message), then position-only fixes
    det.update(pos('111111111', min(0), SEA_LAT, SEA_LON), TANKER)
    det.update(pos('222222222', min(0), SEA_LAT + NEARBY, SEA_LON), TANKER)
    const hits = []
    for (let m = 5; m <= 35; m += 5) {
      hits.push(...det.update(pos('111111111', min(m), SEA_LAT, SEA_LON)))
      hits.push(...det.update(pos('222222222', min(m), SEA_LAT + NEARBY, SEA_LON)))
    }
    expect(hits).toHaveLength(1)
  })

  it('does not re-report a pair within the 6 h cooldown even after a state reset', () => {
    const first = runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 35)
    expect(first).toHaveLength(1)
    // 15-min coverage hole > position TTL — stationary + pair state get purged
    const again = runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 60, TANKER, TANKER, 50)
    expect(again).toHaveLength(0)
  })

  it('reports the same pair again once the cooldown has expired', () => {
    const first = runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 35)
    expect(first).toHaveLength(1)
    // next episode starts 7 h later — past the 6 h cooldown
    const again = runPair(SEA_LAT, SEA_LON, SEA_LAT + NEARBY, SEA_LON, 35, TANKER, TANKER, 7 * 60)
    expect(again).toHaveLength(1)
  })

  it('treats the Rotterdam city basins (Maashaven) as in-port', () => {
    // Rafted inland barges in the Maashaven were the main source of false positives
    const hits = runPair(51.8999, 4.4903, 51.9000, 4.4894, 60)
    expect(hits).toHaveLength(0)
  })
})

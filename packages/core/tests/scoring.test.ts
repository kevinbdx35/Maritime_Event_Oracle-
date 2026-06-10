import { describe, it, expect } from 'vitest'
import { computeConfidence } from '../src/scoring/confidence.js'
import { CONFIDENCE_WEIGHTS } from '../src/scoring/weights.js'
import type { PositionRecord } from '../src/types/vessel.js'

function makePos(sog: number, minutesAgo: number): PositionRecord {
  return {
    mmsi: '244820000',
    time: new Date(Date.now() - minutesAgo * 60_000),
    lat: 51.97,
    lon: 4.05,
    sog,
    cog: 0,
    source: 'aisstream',
  }
}

describe('Confidence scoring', () => {
  it('weights sum to 1.0', () => {
    const sum = Object.values(CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 5)
  })

  it('perfect scenario scores above 80', () => {
    // 12 messages in window, all consistent slow speed, tracked for 2h, aisstream source
    const positions = Array.from({ length: 12 }, (_, i) =>
      makePos(0.2, 20 - i * 1.5),
    )
    const result = computeConfidence({
      windowPositions: positions,
      trackingAgeMinutes: 120,
      source: 'aisstream',
    })
    expect(result.weighted_score).toBeGreaterThan(80)
  })

  it('penalises impossible acceleration', () => {
    // Speed jumps from 0 to 20 kn in 1 minute — physically impossible for a merchant
    const positions = [
      makePos(0.2, 10),
      makePos(20.0, 9),
      makePos(0.1, 8),
    ]
    const bad = computeConfidence({
      windowPositions: positions,
      trackingAgeMinutes: 60,
      source: 'aisstream',
    })
    const good = computeConfidence({
      windowPositions: [makePos(0.2, 10), makePos(0.3, 9), makePos(0.2, 8)],
      trackingAgeMinutes: 60,
      source: 'aisstream',
    })
    expect(bad.kinematic_consistency).toBeLessThan(good.kinematic_consistency)
  })

  it('new vessel (0 tracking age) scores lower than established vessel', () => {
    const positions = [makePos(0.2, 5), makePos(0.2, 10)]
    const newVessel = computeConfidence({ windowPositions: positions, trackingAgeMinutes: 0,   source: 'aisstream' })
    const oldVessel = computeConfidence({ windowPositions: positions, trackingAgeMinutes: 120, source: 'aisstream' })
    expect(newVessel.transponder_history).toBeLessThan(oldVessel.transponder_history)
    expect(newVessel.weighted_score).toBeLessThan(oldVessel.weighted_score)
  })

  it('satellite source scores lower than terrestrial', () => {
    const positions = [makePos(0.2, 5), makePos(0.2, 10)]
    const terrestrial = computeConfidence({ windowPositions: positions, trackingAgeMinutes: 60, source: 'aisstream' })
    const satellite   = computeConfidence({ windowPositions: positions, trackingAgeMinutes: 60, source: 'satellite' })
    expect(terrestrial.source_quality).toBeGreaterThan(satellite.source_quality)
  })

  it('breakdown fields are all 0-100', () => {
    const positions = [makePos(0.5, 5), makePos(0.4, 10), makePos(0.3, 15)]
    const result = computeConfidence({ windowPositions: positions, trackingAgeMinutes: 30, source: 'aisstream' })
    for (const [key, val] of Object.entries(result)) {
      expect(val, key).toBeGreaterThanOrEqual(0)
      expect(val, key).toBeLessThanOrEqual(100)
    }
  })
})

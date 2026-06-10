import type { PositionRecord } from '../types/vessel.js'
import type { ConfidenceBreakdown } from '../types/events.js'
import {
  CONFIDENCE_WEIGHTS,
  DENSITY_SATURATION_COUNT,
  MAX_ACCEL_KN_PER_MIN,
  HISTORY_SATURATION_MINUTES,
  SOURCE_SCORES,
} from './weights.js'

interface ScoringInput {
  /** All positions in the detection window (used for density + kinematics) */
  windowPositions: PositionRecord[]
  /** Minutes since first time we saw this MMSI */
  trackingAgeMinutes: number
  /** Primary source name */
  source: string
  /** Independent sources that observed this MMSI in the last 10 min (for corroboration) */
  corroborationSources?: string[]
}

function scoreMessageDensity(count: number): number {
  return Math.min(100, (count / DENSITY_SATURATION_COUNT) * 100)
}

function scoreKinematicConsistency(positions: PositionRecord[]): number {
  if (positions.length < 2) return 50 // not enough data — neutral

  let penalties = 0
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1]!
    const curr = positions[i]!
    const dtMin =
      (curr.time.getTime() - prev.time.getTime()) / 60_000
    if (dtMin <= 0) continue

    const dSog = Math.abs(curr.sog - prev.sog)
    const accelKnPerMin = dSog / dtMin
    if (accelKnPerMin > MAX_ACCEL_KN_PER_MIN) {
      // penalise proportionally to how far over the limit
      penalties += Math.min(25, (accelKnPerMin - MAX_ACCEL_KN_PER_MIN) * 5)
    }
  }
  return Math.max(0, 100 - penalties)
}

function scoreTransponderHistory(ageMinutes: number): number {
  return Math.min(100, (ageMinutes / HISTORY_SATURATION_MINUTES) * 100)
}

function scoreSourceQuality(source: string): number {
  return SOURCE_SCORES[source] ?? 50
}

function scoreCorroboration(sources: string[]): number {
  const n = sources.length
  if (n === 0) return 0
  if (n === 1) return 50
  if (n === 2) return 80
  return 100
}

export function computeConfidence(input: ScoringInput): ConfidenceBreakdown {
  const message_density      = scoreMessageDensity(input.windowPositions.length)
  const kinematic_consistency = scoreKinematicConsistency(input.windowPositions)
  const transponder_history  = scoreTransponderHistory(input.trackingAgeMinutes)
  const source_quality       = scoreSourceQuality(input.source)
  const source_corroboration = scoreCorroboration(input.corroborationSources ?? [input.source])

  const weighted_score =
    message_density       * CONFIDENCE_WEIGHTS.message_density +
    kinematic_consistency * CONFIDENCE_WEIGHTS.kinematic_consistency +
    transponder_history   * CONFIDENCE_WEIGHTS.transponder_history +
    source_quality        * CONFIDENCE_WEIGHTS.source_quality +
    source_corroboration  * CONFIDENCE_WEIGHTS.source_corroboration

  return {
    message_density:       Math.round(message_density * 10) / 10,
    kinematic_consistency: Math.round(kinematic_consistency * 10) / 10,
    transponder_history:   Math.round(transponder_history * 10) / 10,
    source_quality:        Math.round(source_quality * 10) / 10,
    source_corroboration:  Math.round(source_corroboration * 10) / 10,
    weighted_score:        Math.round(weighted_score * 10) / 10,
  }
}

/**
 * Confidence score weights — all must sum to 1.0.
 * Each component is scored 0-100, then multiplied by its weight.
 * Edit here; tests will catch if weights no longer sum to 1.
 */
export const CONFIDENCE_WEIGHTS = {
  // Density of AIS messages in the ±10-min window around the event.
  message_density: 0.30,

  // Physical plausibility of speed and course changes.
  kinematic_consistency: 0.25,

  // How long we have been tracking this MMSI without discontinuity.
  transponder_history: 0.18,

  // Static score per data source (AISStream=85, AISHub=80, satellite=70…).
  source_quality: 0.12,

  // How many independent sources corroborate this MMSI in the last 10 min.
  // 1 source → 50, 2 sources → 80, 3+ sources → 100.
  source_corroboration: 0.15,
} as const satisfies Record<string, number>

// Density component: number of messages in window that saturates to score 100
export const DENSITY_SATURATION_COUNT = 12 // ≥12 messages in 20 min → score 100

// Kinematic: max plausible acceleration in knots-per-minute for a merchant vessel
export const MAX_ACCEL_KN_PER_MIN = 2.0

// History: minutes of continuous tracking that saturates to score 100
export const HISTORY_SATURATION_MINUTES = 120

// Static source quality scores (0-100)
export const SOURCE_SCORES: Record<string, number> = {
  aisstream:   85, // terrestrial WebSocket, ~2 s latency
  digitraffic: 82, // official Fintraffic open data, ~30 s polling
  aishub:      80, // terrestrial HTTP polling, ~60 s latency
  satellite:   70, // sat AIS, higher latency / lower density
  manual:      50,
}

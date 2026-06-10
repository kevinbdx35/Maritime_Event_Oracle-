// AIS_GAP detector: fires when a vessel tracked in the area goes silent > 1h.
// Maintains one timer per MMSI. Thread-safe as long as updates are sequential.

const GAP_THRESHOLD_MS    = 60 * 60 * 1000   // 1 hour
const RECENCY_WINDOW_MS   = 6 * 60 * 60 * 1000 // vessel must have been seen in last 6h

export interface GapEvent {
  mmsi: string
  gapStartedAt: Date
  lastKnownLat: number
  lastKnownLon: number
}

type GapCallback = (gap: GapEvent) => void

interface TrackedVessel {
  lastSeen: Date
  lastLat: number
  lastLon: number
  timer: ReturnType<typeof setTimeout>
}

export class GapDetector {
  private vessels = new Map<string, TrackedVessel>()

  constructor(private readonly onGap: GapCallback) {}

  /** Call every time a position arrives for a vessel in the area. */
  touch(mmsi: string, time: Date, lat: number, lon: number): void {
    const existing = this.vessels.get(mmsi)
    if (existing) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      this.onGap({ mmsi, gapStartedAt: time, lastKnownLat: lat, lastKnownLon: lon })
      this.vessels.delete(mmsi)
    }, GAP_THRESHOLD_MS)

    this.vessels.set(mmsi, { lastSeen: time, lastLat: lat, lastLon: lon, timer })
  }

  /** Call when vessel leaves the area; stop watching. */
  untrack(mmsi: string): void {
    const existing = this.vessels.get(mmsi)
    if (existing) {
      clearTimeout(existing.timer)
      this.vessels.delete(mmsi)
    }
  }

  /** For replay/testing: advance simulated time (clears real timers, fires callbacks synchronously). */
  simulateTimeAdvance(mmsi: string, newTime: Date): GapEvent | null {
    const vessel = this.vessels.get(mmsi)
    if (!vessel) return null
    const elapsed = newTime.getTime() - vessel.lastSeen.getTime()
    if (elapsed >= GAP_THRESHOLD_MS) {
      clearTimeout(vessel.timer)
      this.vessels.delete(mmsi)
      return {
        mmsi,
        gapStartedAt: vessel.lastSeen,
        lastKnownLat: vessel.lastLat,
        lastKnownLon: vessel.lastLon,
      }
    }
    return null
  }

  destroy(): void {
    for (const v of this.vessels.values()) clearTimeout(v.timer)
    this.vessels.clear()
  }
}

// Tracks which independent AIS sources have observed a given MMSI
// within a sliding window. Used to compute the source_corroboration
// confidence component.

const WINDOW_MS = 10 * 60 * 1_000 // 10-minute sliding window

export class CorroborationTracker {
  // mmsi → source → last-seen epoch ms
  private readonly data = new Map<string, Map<string, number>>()

  record(mmsi: string, source: string): void {
    let sources = this.data.get(mmsi)
    if (!sources) { sources = new Map(); this.data.set(mmsi, sources) }
    sources.set(source, Date.now())
  }

  getActiveSources(mmsi: string): string[] {
    const sources = this.data.get(mmsi)
    if (!sources) return []
    const cutoff = Date.now() - WINDOW_MS
    return [...sources.entries()]
      .filter(([, ts]) => ts > cutoff)
      .map(([src]) => src)
  }

  // 0 sources → 0  |  1 source → 50  |  2 sources → 80  |  3+ → 100
  getScore(mmsi: string): number {
    const n = this.getActiveSources(mmsi).length
    if (n === 0) return 0
    if (n === 1) return 50
    if (n === 2) return 80
    return 100
  }
}

export const corroborationTracker = new CorroborationTracker()

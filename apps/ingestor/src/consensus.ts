// ConsensusGate — multi-source position corroboration before FSM event generation.
//
// Positions are always persisted by the processor regardless of this gate.
// This gate only controls whether a message proceeds to FSM state transitions
// (which generate PORT_ARRIVAL / PORT_DEPARTURE events and anchored proofs).
//
// Rules:
//   - ≥ MIN_SOURCES distinct sources observed the vessel in the last WINDOW_MS
//     → pass through immediately (consensus reached)
//   - Only 1 source, but the vessel has been seen for ≥ FALLBACK_MS
//     → pass through anyway (single-source fallback, lower confidence)
//   - Otherwise → drop (wait for more corroboration)

const WINDOW_MS   = 5 * 60_000  // 5-minute corroboration window
const FALLBACK_MS = 60_000      // emit single-source after 60 s
const MIN_SOURCES = parseInt(process.env['CONSENSUS_MIN_SOURCES'] ?? '2')

interface Observation {
  source: string
  receivedAt: number
}

export class ConsensusGate {
  private readonly buf         = new Map<string, Observation[]>()
  private readonly lastForward = new Map<string, number>()

  // Returns true if the message should proceed to FSM processing.
  check(mmsi: string, source: string): boolean {
    const now    = Date.now()
    const cutoff = now - WINDOW_MS

    let obs = this.buf.get(mmsi)
    if (!obs) { obs = []; this.buf.set(mmsi, obs) }

    // Prune stale observations and record current one
    const pruned = obs.filter(o => o.receivedAt > cutoff)
    pruned.push({ source, receivedAt: now })
    this.buf.set(mmsi, pruned)

    const sourcesInWindow = new Set(pruned.map(o => o.source)).size

    // Consensus: multiple independent sources agree
    if (sourcesInWindow >= MIN_SOURCES) {
      this.lastForward.set(mmsi, now)
      return true
    }

    // Fallback: single source has been reporting long enough
    const last = this.lastForward.get(mmsi)
    if (last === undefined || now - last >= FALLBACK_MS) {
      this.lastForward.set(mmsi, now)
      return true
    }

    return false
  }

  // Number of distinct sources currently in the window for a given vessel.
  sourceCount(mmsi: string): number {
    const cutoff = Date.now() - WINDOW_MS
    const obs    = this.buf.get(mmsi) ?? []
    return new Set(obs.filter(o => o.receivedAt > cutoff).map(o => o.source)).size
  }

  get minSources(): number { return MIN_SOURCES }
}

export const consensusGate = new ConsensusGate()

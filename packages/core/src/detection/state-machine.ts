import { VesselState } from '../types/vessel.js'
import type { PositionRecord } from '../types/vessel.js'
import type { EventType } from '../types/events.js'
import { isInPort, isInAnchorage } from '../geo/index.js'

// Hysteresis thresholds
const ARRIVAL_SPEED_KNOTS   = 1.0   // must be below this
const DEPARTURE_SPEED_KNOTS = 3.0   // must be above this
const ANCHOR_SPEED_KNOTS    = 0.5   // must be below this

const ARRIVAL_WINDOW_MIN    = 20    // minutes of slow speed required
const DEPARTURE_WINDOW_MIN  = 10
const ANCHOR_WINDOW_MIN     = 20

export interface StateTransition {
  eventType: EventType
  timestamp: Date
  fromState: VesselState
  toState: VesselState
  positions: PositionRecord[] // evidence window
}

export class VesselStateMachine {
  private state: VesselState = VesselState.UNKNOWN
  private history: PositionRecord[] = [] // rolling window, max WINDOW_SIZE
  private static readonly WINDOW_SIZE = 60 // keep last 60 positions per vessel

  constructor(
    readonly mmsi: string,
    initialState: VesselState = VesselState.UNKNOWN,
  ) {
    this.state = initialState
  }

  get currentState(): VesselState { return this.state }

  /**
   * Feed a new position. Returns a transition if an event should be emitted,
   * or null if no state change.
   */
  update(pos: PositionRecord): StateTransition | null {
    this.history.push(pos)
    if (this.history.length > VesselStateMachine.WINDOW_SIZE) {
      this.history.shift()
    }

    const inPort      = isInPort(pos.lat, pos.lon)
    const inAnchorage = isInAnchorage(pos.lat, pos.lon).inside

    switch (this.state) {
      case VesselState.UNKNOWN:
      case VesselState.AT_SEA:
        return this.checkArrivalOrAnchor(pos, inPort, inAnchorage)

      case VesselState.APPROACHING:
        return this.checkArrivalOrAnchor(pos, inPort, inAnchorage)

      case VesselState.ANCHORED:
        return this.checkAnchorEnd(pos, inPort, inAnchorage)

      case VesselState.MOORED:
        return this.checkDeparture(pos, inPort)

      case VesselState.DEPARTED:
        // brief state, reset to AT_SEA after one position outside
        if (!inPort && !inAnchorage) {
          this.state = VesselState.AT_SEA
        }
        return null
    }
  }

  private checkArrivalOrAnchor(
    pos: PositionRecord,
    inPort: boolean,
    inAnchorage: boolean,
  ): StateTransition | null {
    // approaching: just entered the area at speed
    if ((inPort || inAnchorage) && this.state === VesselState.AT_SEA) {
      this.state = VesselState.APPROACHING
    }

    if (inAnchorage && !inPort) {
      // check sustained slow speed for anchorage
      const window = this.slowSpeedWindow(ANCHOR_SPEED_KNOTS, ANCHOR_WINDOW_MIN)
      if (window) {
        return this.transition(VesselState.ANCHORED, 'ANCHORAGE_START', pos.time, window)
      }
    }

    if (inPort) {
      // check sustained slow speed for arrival
      const window = this.slowSpeedWindow(ARRIVAL_SPEED_KNOTS, ARRIVAL_WINDOW_MIN)
      if (window) {
        return this.transition(VesselState.MOORED, 'PORT_ARRIVAL', pos.time, window)
      }
    }

    return null
  }

  private checkAnchorEnd(
    pos: PositionRecord,
    inPort: boolean,
    inAnchorage: boolean,
  ): StateTransition | null {
    if (inPort) {
      const window = this.slowSpeedWindow(ARRIVAL_SPEED_KNOTS, ARRIVAL_WINDOW_MIN)
      if (window) {
        return this.transition(VesselState.MOORED, 'ANCHORAGE_END', pos.time, window)
      }
    }
    if (!inAnchorage && !inPort) {
      const window = this.fastSpeedWindow(DEPARTURE_SPEED_KNOTS, DEPARTURE_WINDOW_MIN)
      if (window) {
        return this.transition(VesselState.AT_SEA, 'ANCHORAGE_END', pos.time, window)
      }
    }
    return null
  }

  private checkDeparture(pos: PositionRecord, inPort: boolean): StateTransition | null {
    if (!inPort) {
      const window = this.fastSpeedWindow(DEPARTURE_SPEED_KNOTS, DEPARTURE_WINDOW_MIN)
      if (window) {
        return this.transition(VesselState.DEPARTED, 'PORT_DEPARTURE', pos.time, window)
      }
    }
    return null
  }

  private transition(
    newState: VesselState,
    eventType: EventType,
    timestamp: Date,
    positions: PositionRecord[],
  ): StateTransition {
    const fromState = this.state
    this.state = newState
    return { eventType, timestamp, fromState, toState: newState, positions }
  }

  /**
   * Returns the evidence window if the vessel has maintained speed ≤ threshold
   * for at least durationMinutes, using sliding median over the window.
   */
  private slowSpeedWindow(thresholdKnots: number, durationMinutes: number): PositionRecord[] | null {
    return this.speedConditionWindow(
      pts => medianSpeed(pts) <= thresholdKnots,
      durationMinutes,
    )
  }

  private fastSpeedWindow(thresholdKnots: number, durationMinutes: number): PositionRecord[] | null {
    return this.speedConditionWindow(
      pts => medianSpeed(pts) >= thresholdKnots,
      durationMinutes,
    )
  }

  private speedConditionWindow(
    condition: (pts: PositionRecord[]) => boolean,
    durationMinutes: number,
  ): PositionRecord[] | null {
    if (this.history.length < 2) return null
    const latest = this.history[this.history.length - 1]!
    const cutoff = new Date(latest.time.getTime() - durationMinutes * 60_000)

    const window = this.history.filter(p => p.time >= cutoff)
    if (window.length < 2) return null

    const spanMin =
      (window[window.length - 1]!.time.getTime() - window[0]!.time.getTime()) / 60_000
    if (spanMin < durationMinutes * 0.8) return null // not enough time covered

    return condition(window) ? window : null
  }
}

function medianSpeed(positions: PositionRecord[]): number {
  const speeds = positions.map(p => p.sog).sort((a, b) => a - b)
  const mid = Math.floor(speeds.length / 2)
  return speeds.length % 2 === 0
    ? ((speeds[mid - 1]! + speeds[mid]!) / 2)
    : speeds[mid]!
}

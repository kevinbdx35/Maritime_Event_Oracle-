export enum VesselState {
  UNKNOWN    = 'UNKNOWN',
  AT_SEA     = 'AT_SEA',
  APPROACHING= 'APPROACHING',
  ANCHORED   = 'ANCHORED',
  MOORED     = 'MOORED',
  DEPARTED   = 'DEPARTED',
}

export interface VesselInfo {
  mmsi: string
  imo?: string
  name?: string
  shipType?: number
  firstSeen: Date
  lastSeen: Date
}

export interface PositionRecord {
  mmsi: string
  time: Date
  lat: number
  lon: number
  sog: number    // knots
  cog: number    // degrees
  heading?: number
  status?: number
  source: string
}

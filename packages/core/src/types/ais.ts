import { z } from 'zod'

// AISStream.io normalized message format
export const AISMessageSchema = z.object({
  t: z.string().datetime(),         // ISO timestamp
  mmsi: z.string().regex(/^\d{9}$/),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  sog: z.number().min(0).max(102.2), // speed over ground in knots
  cog: z.number().min(0).max(360),   // course over ground
  heading: z.number().min(0).max(511).optional(), // 511 = not available
  status: z.number().int().min(0).max(15).optional(), // AIS nav status
  msgType: z.number().int().min(1).max(27),
  imo: z.string().optional(),
  name: z.string().optional(),
  shipType: z.number().int().optional(),
  source: z.string().default('aisstream'),
})

export type AISMessage = z.infer<typeof AISMessageSchema>

export const ROTTERDAM_BBOX = {
  minLon: 3.8,
  maxLon: 4.6,
  minLat: 51.75,
  maxLat: 52.05,
} as const

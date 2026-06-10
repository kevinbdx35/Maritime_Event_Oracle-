import type { FastifyInstance } from 'fastify'
import { query } from '../db.js'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    let dbStatus = 'ok'
    try {
      await query('SELECT 1')
    } catch {
      dbStatus = 'error'
    }

    const status = dbStatus === 'ok' ? 'ok' : 'degraded'
    return reply.code(status === 'ok' ? 200 : 503).send({
      status,
      version: '0.1.0',
      uptime:  Math.floor(process.uptime()),
      db:      dbStatus,
      timestamp: new Date().toISOString(),
    })
  })
}

import Fastify from 'fastify'
import { authHook }        from './auth.js'
import { eventsRoutes }    from './routes/events.js'
import { vesselsRoutes }   from './routes/vessels.js'
import { proofsRoutes }    from './routes/proofs.js'
import { voyagesRoutes }   from './routes/voyages.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { keysRoutes }      from './routes/keys.js'
import { healthRoutes }    from './routes/health.js'
import { verifyRoutes }    from './routes/verify.js'
import { setupWebhooks }   from './webhooks.js'

const app = Fastify({ logger: true })

// Auth guard applied before every route handler
app.addHook('onRequest', authHook)

await app.register(dashboardRoutes)
await app.register(eventsRoutes)
await app.register(vesselsRoutes)
await app.register(proofsRoutes)
await app.register(voyagesRoutes)
await app.register(keysRoutes)
await app.register(healthRoutes)
await app.register(verifyRoutes)

setupWebhooks()

const port = parseInt(process.env['PORT'] ?? '3000')
await app.listen({ port, host: '0.0.0.0' })

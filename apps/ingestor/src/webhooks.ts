import { createHmac } from 'crypto'
import { eventBus } from './processor.js'
import type { MaritimeEvent } from '@maritime/core'

const WEBHOOK_SECRET = process.env['WEBHOOK_SECRET'] ?? ''
const WEBHOOK_URLS   = (process.env['WEBHOOK_URLS'] ?? '').split(',').filter(Boolean)

function sign(payload: string): string {
  return 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')
}

async function dispatch(evt: MaritimeEvent): Promise<void> {
  const body = JSON.stringify(evt)
  const sig  = sign(body)

  await Promise.allSettled(
    WEBHOOK_URLS.map(url =>
      fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':           'application/json',
          'X-Maritime-Signature':   sig,
          'X-Maritime-Event':       evt.event,
        },
        body,
      }).catch(err => console.warn(`[webhook] delivery failed to ${url}:`, err.message))
    )
  )
}

export function setupWebhooks(): void {
  if (!WEBHOOK_URLS.length) return
  eventBus.on('event', (evt: MaritimeEvent) => {
    dispatch(evt).catch(err => console.error('[webhook] error', err))
  })
  console.log(`[webhooks] registered for ${WEBHOOK_URLS.length} endpoint(s)`)
}

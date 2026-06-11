// Connector registry — plug-and-play source management.
//
// To add a new AIS source:
//   1. Create apps/ingestor/src/connectors/<name>.ts
//      (implement AISConnector, export `descriptor` and `create()`)
//   2. Add one import + one entry in REGISTRY below — that's it.

import type { AISConnector, ConnectorModule } from './base.js'
import * as aisstream   from './aisstream.js'
import * as aishub      from './aishub.js'
import * as digitraffic from './digitraffic.js'

const REGISTRY: ConnectorModule[] = [
  aisstream,
  aishub,
  digitraffic,
  // ← add new connectors here
]

export function loadConnectors(): AISConnector[] {
  const active: AISConnector[] = []

  for (const mod of REGISTRY) {
    const key = process.env[mod.descriptor.envKey]
    if (key) {
      active.push(mod.create(key))
      console.log(`[registry] ✓ ${mod.descriptor.name} (${mod.descriptor.transport}) — ${mod.descriptor.description}`)
    } else {
      console.log(`[registry] ✗ ${mod.descriptor.name} — ${mod.descriptor.envKey} not set, skipped`)
    }
  }

  if (active.length === 0) {
    console.warn('[registry] no connectors active — running in demo/replay mode')
  } else {
    console.log(`[registry] ${active.length}/${REGISTRY.length} source(s) active`)
  }

  return active
}

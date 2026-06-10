import { EventEmitter } from 'events'
import type { AISMessage } from '@maritime/core'

export abstract class AISConnector extends EventEmitter {
  abstract readonly name: string
  abstract start(): Promise<void>
  abstract stop(): void

  protected emitMessage(msg: AISMessage): void {
    this.emit('message', msg)
  }

  onMessage(handler: (msg: AISMessage) => void): this {
    return this.on('message', handler)
  }
}

export interface ConnectorDescriptor {
  name: string
  envKey: string
  description: string
  transport: 'websocket' | 'http-poll' | 'mqtt' | 'file'
}

export interface ConnectorModule {
  descriptor: ConnectorDescriptor
  create(apiKey: string): AISConnector
}

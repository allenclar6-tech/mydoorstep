import { WebSocketServer } from 'ws'
import { authenticateBearerToken } from './auth.js'
import { getDeliveryTrackingSnapshot, recordLocation, validateLocationUpdate } from './deliveryService.js'

const OPEN = 1

function bearerToken(request) {
  const authorization = request.headers.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) return authorization.slice(7)
  const protocols = String(request.headers['sec-websocket-protocol'] || '').split(',').map((value) => value.trim())
  const bearerIndex = protocols.indexOf('bearer')
  return bearerIndex >= 0 ? protocols[bearerIndex + 1] : null
}

function send(socket, message) {
  if (socket.readyState === OPEN) socket.send(JSON.stringify(message))
}

export class DeliveryRealtime {
  constructor() {
    this.clients = new Map()
    this.server = null
  }

  attach(server) {
    if (this.server) return
    this.server = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => protocols.has('bearer') ? 'bearer' : false,
    })
    server.on('upgrade', async (request, socket, head) => {
      let url
      try { url = new URL(request.url, 'http://localhost') } catch { socket.destroy(); return }
      const match = /^\/api\/deliveries\/([^/]+)\/live$/.exec(url.pathname)
      if (!match) return
      try {
        const authenticated = await authenticateBearerToken(bearerToken(request))
        if (!authenticated) { socket.destroy(); return }
        const snapshot = await getDeliveryTrackingSnapshot(match[1], authenticated.user, { activeOnly: true })
        this.server.handleUpgrade(request, socket, head, (websocket) => {
          this.server.emit('connection', websocket, request, { deliveryId: match[1], user: authenticated.user, snapshot })
        })
      } catch {
        socket.destroy()
      }
    })
    this.server.on('connection', (socket, _request, context) => {
      const { deliveryId, user, snapshot } = context
      const clients = this.clients.get(deliveryId) || new Set()
      clients.add(socket)
      this.clients.set(deliveryId, clients)
      send(socket, { type: 'tracking.snapshot', ...snapshot })
      socket.on('close', () => {
        clients.delete(socket)
        if (!clients.size) this.clients.delete(deliveryId)
      })
      socket.on('message', async (raw) => {
        let message
        try { message = JSON.parse(raw.toString()) } catch { send(socket, { type: 'error', error: 'INVALID_MESSAGE' }); return }
        if (message?.type !== 'location' || user.role !== 'RIDER' || !user.rider) {
          send(socket, { type: 'error', error: 'LOCATION_UPDATE_FORBIDDEN' })
          return
        }
        try {
          const location = validateLocationUpdate(message)
          const saved = await recordLocation(deliveryId, user.rider.id, location)
          this.broadcastLocation(deliveryId, saved)
        } catch (error) {
          send(socket, { type: 'error', error: error.code || 'LOCATION_SERVICE_UNAVAILABLE' })
        }
      })
    })
  }

  broadcastLocation(deliveryId, location) {
    const message = {
      type: 'tracking.location',
      deliveryId,
      location: { latitude: location.latitude, longitude: location.longitude, recordedAt: location.recordedAt },
    }
    for (const socket of this.clients.get(deliveryId) || []) send(socket, message)
  }
}

export const deliveryRealtime = new DeliveryRealtime()

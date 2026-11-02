import { Router } from 'express'
import { z } from 'zod'
import { vapidKeys } from './push.js'

// Devices sign up for push notifications here (the browser does the permission prompt).
export function createPushRouter({ prisma, requireUser }) {
  const router = Router()
  router.get('/push/public-key', async (_request, response) => {
    try {
      const keys = await vapidKeys(prisma)
      if (!keys) return response.status(503).json({ error: 'PUSH_UNAVAILABLE', message: 'Phone notifications aren’t set up on the server yet.' })
      return response.json({ publicKey: keys.publicKey })
    } catch { return response.status(503).json({ error: 'PUSH_UNAVAILABLE' }) }
  })
  const subscriptionSchema = z.object({ endpoint: z.string().url().startsWith('https://').max(2500), keys: z.object({ p256dh: z.string().min(10).max(400), auth: z.string().min(8).max(200) }) })
  router.post('/push/subscribe', requireUser, async (request, response) => {
    const parsed = subscriptionSchema.safeParse(request.body?.subscription)
    if (!parsed.success) { console.warn('[push] subscription rejected', parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')); return response.status(400).json({ error: 'INVALID_SUBSCRIPTION' }) }
    try {
      const { endpoint, keys } = parsed.data
      await prisma.pushSubscription.upsert({ where: { endpoint }, update: { userId: request.user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent: String(request.get('user-agent') || '').slice(0, 300) }, create: { userId: request.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: String(request.get('user-agent') || '').slice(0, 300) } })
      return response.status(201).json({ subscribed: true })
    } catch (error) { console.error('[push] could not save subscription', error?.code || error?.message); return response.status(503).json({ error: 'PUSH_UNAVAILABLE' }) }
  })
  router.post('/push/unsubscribe', requireUser, async (request, response) => {
    const endpoint = String(request.body?.endpoint || '')
    try { await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: request.user.id } }); return response.json({ unsubscribed: true }) } catch { return response.status(503).json({ error: 'PUSH_UNAVAILABLE' }) }
  })
  return router
}

import { Router } from 'express'
import { z } from 'zod'
import { CHANNELS, chatWindow, cleanLocation, CLOSED_TEXT, HIDDEN_TEXT, MAX_MESSAGE_LENGTH, participantRole, QUICK_REPLIES, RATE_LIMIT, screenMessage, underRateLimit } from './orderChat.js'
import { restaurantTeamIds } from './notify.js'

// Order chat API. An order is found by its id or its order number (riders and businesses see order numbers).
// Only the order's customer, its assigned rider and the business's team can read or write their channel;
// admins can read every chat and see reports.

const orderInclude = {
  delivery: { select: { riderId: true, status: true, pickedUpAt: true, deliveredAt: true, rider: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } } } },
  customer: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
  restaurant: { select: { id: true, name: true } },
}
const nameOf = (person) => person ? (person.preferredName || person.firstName || '').trim() || 'Customer' : null

export function createOrderChatRouter({ prisma, requireUser, requireAdmin }) {
  const router = Router()

  const findOrder = (ref) => prisma.order.findFirst({ where: { OR: [{ id: ref }, { orderNumber: ref }] }, include: orderInclude })
  async function access(request, channel) {
    if (!CHANNELS.includes(channel)) return { status: 400, error: 'INVALID_CHANNEL' }
    const order = await findOrder(String(request.params.ref).slice(0, 80))
    if (!order) return { status: 404, error: 'ORDER_NOT_FOUND' }
    // The store team is needed to check a business user's access and to alert the store about a rider's message.
    const team = channel === 'STORE_RIDER' ? await restaurantTeamIds(prisma, order.restaurantId) : []
    const role = participantRole(request.user, order, channel, { storeMemberIds: team })
    if (!role) return { status: 403, error: 'NOT_IN_THIS_CHAT' }
    return { order, role, team, window: chatWindow(order, channel) }
  }
  const otherParty = (order, channel, role) => {
    const riderName = order.delivery?.rider?.user ? `${order.delivery.rider.user.firstName || ''}`.trim() || 'Your rider' : 'Your rider'
    if (channel === 'CUSTOMER_RIDER') return role === 'CUSTOMER' ? { role: 'RIDER', name: riderName } : { role: 'CUSTOMER', name: nameOf(order.customer) }
    return role === 'STORE' ? { role: 'RIDER', name: riderName } : { role: 'STORE', name: order.restaurant?.name || 'The store' }
  }
  const view = (message, myRole) => ({ id: message.id, mine: message.senderRole === myRole, from: message.senderRole, kind: message.kind, body: message.body, location: message.latitude != null ? { latitude: Number(message.latitude), longitude: Number(message.longitude) } : null, hidden: message.hidden.length > 0, readAt: message.readAt, createdAt: message.createdAt })

  router.get('/order-chat/:ref', requireUser, async (request, response) => {
    const channel = String(request.query.channel || 'CUSTOMER_RIDER')
    try {
      const found = await access(request, channel)
      if (found.error) return response.status(found.status).json({ error: found.error })
      const { order, role, window } = found
      const messages = window.canRead ? await prisma.orderChatMessage.findMany({ where: { orderId: order.id, channel }, orderBy: { createdAt: 'asc' }, take: 300 }) : []
      return response.json({ orderId: order.id, orderNumber: order.orderNumber, channel, me: role, other: otherParty(order, channel, role), canSend: window.canSend, closedText: window.canSend ? null : CLOSED_TEXT[window.reason], quickReplies: QUICK_REPLIES[channel][role] || [], maxLength: MAX_MESSAGE_LENGTH, messages: messages.map((message) => view(message, role)) })
    } catch (error) { console.error('[chat] read failed', error?.message); return response.status(503).json({ error: 'CHAT_UNAVAILABLE' }) }
  })

  const sendSchema = z.object({ channel: z.enum(CHANNELS), body: z.string().max(2000).optional(), quickReply: z.number().int().min(0).max(20).optional(), location: z.object({ latitude: z.number(), longitude: z.number() }).optional() }).strict()
  router.post('/order-chat/:ref', requireUser, async (request, response) => {
    const parsed = sendSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_MESSAGE' })
    try {
      const found = await access(request, parsed.data.channel)
      if (found.error) return response.status(found.status).json({ error: found.error })
      const { order, role, window, team } = found
      const channel = parsed.data.channel
      if (!window.canSend) return response.status(409).json({ error: 'CHAT_CLOSED', message: CLOSED_TEXT[window.reason] })
      const recent = await prisma.orderChatMessage.findMany({ where: { senderId: request.user.id, createdAt: { gte: new Date(Date.now() - RATE_LIMIT.windowMs) } }, select: { createdAt: true } })
      if (!underRateLimit(recent.map((row) => row.createdAt))) return response.status(429).json({ error: 'TOO_MANY_MESSAGES', message: 'You’re sending messages too fast. Wait a moment, or use the Call button.' })

      let data
      if (parsed.data.location) {
        const point = cleanLocation(parsed.data.location)
        if (!point) return response.status(400).json({ error: 'INVALID_LOCATION', message: 'That location couldn’t be shared.' })
        data = { kind: 'LOCATION', body: role === 'RIDER' ? 'My current location' : 'My location', ...point, hidden: [] }
      } else if (parsed.data.quickReply != null) {
        const text = (QUICK_REPLIES[channel][role] || [])[parsed.data.quickReply]
        if (!text) return response.status(400).json({ error: 'INVALID_MESSAGE' })
        data = { kind: 'QUICK', body: text, hidden: [] }
      } else {
        const screened = screenMessage(parsed.data.body)
        if (!screened.text || screened.text === '•••') return response.status(400).json({ error: 'EMPTY_MESSAGE', message: screened.hidden.length ? HIDDEN_TEXT : 'Type a message first.' })
        data = { kind: 'TEXT', body: screened.text, hidden: screened.hidden }
      }
      const message = await prisma.orderChatMessage.create({ data: { orderId: order.id, channel, senderId: request.user.id, senderRole: role, ...data } })

      // Tell the other side (one unread alert per chat, so a burst of messages doesn't flood their phone).
      const recipients = channel === 'CUSTOMER_RIDER' ? (role === 'CUSTOMER' ? [order.delivery.rider?.userId] : [order.customerId]) : (role === 'STORE' ? [order.delivery.rider?.userId] : team)
      const link = (userId) => userId === order.customerId ? `/account/orders/${order.id}?chat=1` : userId === order.delivery.rider?.userId ? `/rider/dashboard?chat=${encodeURIComponent(order.orderNumber)}&channel=${channel}` : `/restaurant/orders?chat=${encodeURIComponent(order.orderNumber)}`
      const from = role === 'RIDER' ? 'Your rider' : role === 'STORE' ? order.restaurant?.name || 'The store' : nameOf(order.customer)
      for (const userId of recipients.filter(Boolean)) {
        const pending = await prisma.notification.findFirst({ where: { userId, readAt: null, link: link(userId) }, select: { id: true } })
        if (!pending) await prisma.notification.create({ data: { userId, type: 'DELIVERY', title: `New message — ${order.orderNumber}`, body: `${from}: ${data.kind === 'LOCATION' ? 'shared a location' : data.body}`.slice(0, 200), link: link(userId) } })
      }
      return response.status(201).json({ message: view(message, role), notice: data.hidden?.length ? HIDDEN_TEXT : null })
    } catch (error) { console.error('[chat] send failed', error?.message); return response.status(503).json({ error: 'CHAT_UNAVAILABLE', message: 'Your message wasn’t sent. Try again.' }) }
  })

  // Marks the other side's messages as read (read ticks) and clears this chat's unread alert.
  router.post('/order-chat/:ref/read', requireUser, async (request, response) => {
    const channel = String(request.body?.channel || '')
    try {
      const found = await access(request, channel)
      if (found.error) return response.status(found.status).json({ error: found.error })
      const { count } = await prisma.orderChatMessage.updateMany({ where: { orderId: found.order.id, channel, readAt: null, NOT: { senderRole: found.role } }, data: { readAt: new Date() } })
      await prisma.notification.updateMany({ where: { userId: request.user.id, readAt: null, link: { contains: found.role === 'CUSTOMER' ? found.order.id : encodeURIComponent(found.order.orderNumber) }, title: { startsWith: 'New message' } }, data: { readAt: new Date() } })
      return response.json({ read: count })
    } catch { return response.status(503).json({ error: 'CHAT_UNAVAILABLE' }) }
  })

  router.post('/order-chat/:ref/report', requireUser, async (request, response) => {
    const parsed = z.object({ channel: z.enum(CHANNELS), messageId: z.string().min(1).max(40), reason: z.string().trim().min(3).max(300) }).strict().safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_REPORT', message: 'Tell us briefly what’s wrong.' })
    try {
      const found = await access(request, parsed.data.channel)
      if (found.error) return response.status(found.status).json({ error: found.error })
      const changed = await prisma.orderChatMessage.updateMany({ where: { id: parsed.data.messageId, orderId: found.order.id, channel: parsed.data.channel, NOT: { senderRole: found.role } }, data: { reportedAt: new Date(), reportReason: parsed.data.reason } })
      if (!changed.count) return response.status(404).json({ error: 'MESSAGE_NOT_FOUND' })
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true }, take: 50 })
      await prisma.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, type: 'SECURITY', title: 'Chat message reported', body: `${found.order.orderNumber}: ${parsed.data.reason}`.slice(0, 200), link: `/admin/chats?order=${encodeURIComponent(found.order.orderNumber)}` })) })
      return response.json({ reported: true })
    } catch { return response.status(503).json({ error: 'CHAT_UNAVAILABLE' }) }
  })

  // Unread counts per order for the signed-in person (badges on "Chat" buttons).
  router.get('/order-chat-unread', requireUser, async (request, response) => {
    try {
      const role = request.user.role
      const where = role === 'CUSTOMER' ? { channel: 'CUSTOMER_RIDER', order: { customerId: request.user.id }, senderRole: { not: 'CUSTOMER' } }
        : role === 'RIDER' && request.user.rider ? { order: { delivery: { riderId: request.user.rider.id } }, senderRole: { not: 'RIDER' } }
          : role === 'RESTAURANT' ? { channel: 'STORE_RIDER', order: { restaurant: { users: { some: { userId: request.user.id } } } }, senderRole: { not: 'STORE' } } : null
      if (!where) return response.json({ unread: {} })
      const rows = await prisma.orderChatMessage.groupBy({ by: ['orderId', 'channel'], where: { ...where, readAt: null, createdAt: { gte: new Date(Date.now() - 2 * 86_400_000) } }, _count: { _all: true } })
      const orders = rows.length ? await prisma.order.findMany({ where: { id: { in: rows.map((row) => row.orderId) } }, select: { id: true, orderNumber: true } }) : []
      const numberOf = Object.fromEntries(orders.map((order) => [order.id, order.orderNumber]))
      return response.json({ unread: Object.fromEntries(rows.map((row) => [`${numberOf[row.orderId]}:${row.channel}`, row._count._all])), byOrderId: Object.fromEntries(rows.map((row) => [`${row.orderId}:${row.channel}`, row._count._all])) })
    } catch { return response.json({ unread: {} }) }
  })

  /* ------------------------------ admin ------------------------------ */
  router.get('/admin/chats', requireUser, requireAdmin, async (request, response) => {
    const ref = String(request.query.order || '').trim().slice(0, 80)
    const reported = request.query.reported === '1'
    try {
      if (!ref) {
        const rows = await prisma.orderChatMessage.findMany({ where: reported ? { reportedAt: { not: null } } : {}, orderBy: { createdAt: 'desc' }, take: 60, include: { order: { select: { orderNumber: true } } } })
        const seen = new Map()
        for (const row of rows) { const key = `${row.order.orderNumber}:${row.channel}`; if (!seen.has(key)) seen.set(key, { orderNumber: row.order.orderNumber, channel: row.channel, last: row.body, at: row.createdAt, reported: rows.some((other) => other.orderId === row.orderId && other.reportedAt) }) }
        return response.json({ chats: [...seen.values()] })
      }
      const order = await findOrder(ref)
      if (!order) return response.status(404).json({ error: 'ORDER_NOT_FOUND' })
      const messages = await prisma.orderChatMessage.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } })
      return response.json({ orderNumber: order.orderNumber, customer: nameOf(order.customer), rider: order.delivery?.rider?.user ? `${order.delivery.rider.user.firstName || ''} ${order.delivery.rider.user.lastName || ''}`.trim() : null, store: order.restaurant?.name, messages: messages.map((message) => ({ ...view(message, 'ADMIN'), channel: message.channel, reportedAt: message.reportedAt, reportReason: message.reportReason })) })
    } catch { return response.status(503).json({ error: 'CHAT_UNAVAILABLE' }) }
  })

  return router
}

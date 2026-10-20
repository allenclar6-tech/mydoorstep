import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { notifyAdmins, notifyUsers } from './notify.js'
import { supportReply } from './supportAssistant.js'
import { isOwnPrivateKey } from './uploadService.js'

// Help chat between customers (and partners/riders) and DOORSTEP agents.
// Ticket status: OPEN (assistant answering) → WAITING_AGENT (person requested) → WITH_AGENT (an agent replied) → RESOLVED.
const CATEGORIES = ['PAYMENT', 'MISSING_ORDER', 'WRONG_FOOD', 'LATE_DELIVERY', 'RESTAURANT', 'RIDER', 'ACCOUNT', 'REFUND', 'TECHNICAL', 'GENERAL']
const STATUSES = ['OPEN', 'WAITING_AGENT', 'WITH_AGENT', 'RESOLVED']
const SUPPORT_LINK = { CUSTOMER: '/account/support', RESTAURANT: '/restaurant/support', RIDER: '/rider/support' }

const attachmentList = z.array(z.string().startsWith('private/').max(500)).max(3).optional()

export function createSupportRouter({ prisma, requireUser, readPrivateDocument }) {
  const router = Router()
  const postLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'SUPPORT_RATE_LIMITED', message: 'You are sending messages very quickly. Wait a moment.' }) })
  const isAdmin = (user) => user.role === 'ADMIN'
  const fail = (response, error) => {
    if (error?.status && error?.code) return response.status(error.status).json({ error: error.code, message: error.message })
    console.error('[support] unexpected_failure', JSON.stringify({ name: error?.name, code: error?.code }))
    return response.status(503).json({ error: 'SUPPORT_SERVICE_UNAVAILABLE' })
  }
  // Everyone, agents included, can only attach files they uploaded themselves.
  const ownsAttachments = (user, keys = []) => keys.every((key) => isOwnPrivateKey(user.id, key))

  async function withSenderNames(messages) {
    const ids = [...new Set(messages.filter((message) => message.senderType === 'ADMIN' && message.senderId).map((message) => message.senderId))]
    const agents = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true } }) : []
    const names = new Map(agents.map((agent) => [agent.id, agent.firstName]))
    return messages.map((message) => ({ id: message.id, senderType: message.senderType, senderName: message.senderType === 'ADMIN' ? names.get(message.senderId) || 'DOORSTEP' : null, body: message.body, attachmentCount: Array.isArray(message.attachments) ? message.attachments.length : 0, createdAt: message.createdAt }))
  }

  async function loadTicket(id, user) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id }, include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true } } } })
    if (!ticket || (!isAdmin(user) && ticket.userId !== user.id)) throw Object.assign(new Error('Conversation not found.'), { code: 'TICKET_NOT_FOUND', status: 404 })
    return ticket
  }

  const publicTicket = (ticket, user) => ({
    id: ticket.id, ticketNumber: ticket.ticketNumber, category: ticket.category, status: ticket.status, createdAt: ticket.createdAt, lastMessageAt: ticket.lastMessageAt, resolution: ticket.resolution,
    ...(isAdmin(user) && ticket.user ? { customer: { name: `${ticket.user.firstName} ${ticket.user.lastName}`.trim(), email: ticket.user.email, phone: ticket.user.phone, role: ticket.user.role } } : {}),
  })

  async function addAssistantReply(transaction, ticket, text, signedIn = true) {
    const reply = await supportReply(prisma, text, { signedIn, category: ticket.category })
    return transaction.supportMessage.create({ data: { ticketId: ticket.id, senderType: 'AI', body: reply } })
  }

  // Public assistant for people who are not signed in (no ticket is stored).
  router.post('/support/ai', postLimiter, async (request, response) => {
    const body = z.object({ message: z.string().trim().min(1).max(2000), category: z.string().max(40).optional() }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'MESSAGE_REQUIRED' })
    return response.json({ reply: await supportReply(prisma, body.data.message, { signedIn: false, category: body.data.category }) })
  })

  router.get('/support/tickets', requireUser, async (request, response) => {
    try {
      if (!isAdmin(request.user)) {
        const tickets = await prisma.supportTicket.findMany({ where: { userId: request.user.id }, include: { messages: { orderBy: { createdAt: 'asc' } } }, orderBy: { lastMessageAt: 'desc' }, take: 30 })
        return response.json({ tickets: await Promise.all(tickets.map(async (ticket) => ({ ...publicTicket(ticket, request.user), description: ticket.description, messages: await withSenderNames(ticket.messages) }))) })
      }
      const query = z.object({ view: z.enum(['needs_reply', 'open', 'resolved', 'all']).default('needs_reply'), q: z.string().trim().max(80).optional() }).parse(request.query)
      const where = {
        ...(query.view === 'resolved' ? { status: 'RESOLVED' } : query.view === 'all' ? {} : { status: { not: 'RESOLVED' } }),
        ...(query.q ? { OR: [{ ticketNumber: { contains: query.q, mode: 'insensitive' } }, { user: { email: { contains: query.q, mode: 'insensitive' } } }, { user: { firstName: { contains: query.q, mode: 'insensitive' } } }, { user: { lastName: { contains: query.q, mode: 'insensitive' } } }, { user: { phone: { contains: query.q } } }] } : {}),
      }
      const tickets = await prisma.supportTicket.findMany({ where, include: { user: { select: { firstName: true, lastName: true, email: true, phone: true, role: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { lastMessageAt: 'desc' }, take: 100 })
      const rows = tickets.map((ticket) => {
        const last = ticket.messages[0]
        // Needs a person: they asked for one, or the customer spoke last after an agent joined.
        const needsReply = ticket.status !== 'RESOLVED' && (ticket.status === 'WAITING_AGENT' || (last?.senderType === 'CUSTOMER' && ticket.status === 'WITH_AGENT') || (ticket.status === 'OPEN' && last?.senderType !== 'ADMIN'))
        return { ...publicTicket(ticket, request.user), needsReply, lastMessage: last ? { senderType: last.senderType, body: last.body.slice(0, 160), createdAt: last.createdAt } : null }
      })
      const counts = { needsReply: rows.filter((row) => row.needsReply).length }
      return response.json({ tickets: query.view === 'needs_reply' ? rows.filter((row) => row.needsReply) : rows, counts })
    } catch (error) { return fail(response, error) }
  })

  // The signed-in person's current conversation (most recent that is not resolved).
  router.get('/support/tickets/active', requireUser, async (request, response) => {
    try {
      const ticket = await prisma.supportTicket.findFirst({ where: { userId: request.user.id, status: { not: 'RESOLVED' } }, include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } }, orderBy: { lastMessageAt: 'desc' } })
      if (!ticket) return response.json({ ticket: null, messages: [] })
      return response.json({ ticket: publicTicket(ticket, request.user), messages: await withSenderNames(ticket.messages) })
    } catch (error) { return fail(response, error) }
  })

  router.get('/support/tickets/:ticketId', requireUser, async (request, response) => {
    try {
      const ticket = await loadTicket(request.params.ticketId, request.user)
      const after = request.query.after ? new Date(String(request.query.after)) : null
      const messages = await prisma.supportMessage.findMany({ where: { ticketId: ticket.id, ...(after && !Number.isNaN(after.getTime()) ? { createdAt: { gt: after } } : {}) }, orderBy: { createdAt: 'asc' }, take: 200 })
      return response.json({ ticket: publicTicket(ticket, request.user), messages: await withSenderNames(messages) })
    } catch (error) { return fail(response, error) }
  })

  router.post('/support/tickets', requireUser, postLimiter, async (request, response) => {
    const body = z.object({ category: z.enum(CATEGORIES).default('GENERAL'), message: z.string().trim().min(1).max(4000).optional(), description: z.string().trim().min(1).max(4000).optional(), attachments: attachmentList }).refine((value) => value.message || value.description).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'MESSAGE_REQUIRED' })
    if (!ownsAttachments(request.user, body.data.attachments)) return response.status(403).json({ error: 'ATTACHMENT_OWNERSHIP_REQUIRED' })
    const text = body.data.message || body.data.description
    try {
      const result = await prisma.$transaction(async (transaction) => {
        const ticket = await transaction.supportTicket.create({ data: { ticketNumber: `DSP-SUP-${Date.now().toString(36).toUpperCase()}`, userId: request.user.id, category: body.data.category, description: text, attachments: body.data.attachments || [], lastMessageAt: new Date() } })
        const message = await transaction.supportMessage.create({ data: { ticketId: ticket.id, senderId: request.user.id, senderType: 'CUSTOMER', body: text, attachments: body.data.attachments || [] } })
        const reply = await addAssistantReply(transaction, ticket, text)
        await notifyAdmins(transaction, { type: 'SYSTEM', title: `New help chat · ${request.user.firstName}`, body: `${ticket.ticketNumber}: ${text}`, link: `/admin/support?ticket=${ticket.id}` })
        return { ticket, messages: [message, reply] }
      })
      return response.status(201).json({ ticket: publicTicket(result.ticket, request.user), messages: await withSenderNames(result.messages), aiReply: result.messages[1] })
    } catch (error) { return fail(response, error) }
  })

  router.post('/support/tickets/:ticketId/messages', requireUser, postLimiter, async (request, response) => {
    const body = z.object({ body: z.string().trim().min(1).max(4000), attachments: attachmentList }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'MESSAGE_REQUIRED' })
    if (!ownsAttachments(request.user, body.data.attachments)) return response.status(403).json({ error: 'ATTACHMENT_OWNERSHIP_REQUIRED' })
    try {
      const ticket = await loadTicket(request.params.ticketId, request.user)
      const agent = isAdmin(request.user) && ticket.userId !== request.user.id
      const created = await prisma.$transaction(async (transaction) => {
        const message = await transaction.supportMessage.create({ data: { ticketId: ticket.id, senderId: request.user.id, senderType: agent ? 'ADMIN' : 'CUSTOMER', body: body.data.body, attachments: body.data.attachments || [] } })
        const nextStatus = agent ? 'WITH_AGENT' : ticket.status === 'RESOLVED' ? 'OPEN' : ticket.status
        await transaction.supportTicket.update({ where: { id: ticket.id }, data: { status: nextStatus, lastMessageAt: new Date(), ...(agent && !ticket.assignedToId ? { assignedToId: request.user.id } : {}), ...(ticket.status === 'RESOLVED' ? { resolvedAt: null } : {}) } })
        const messages = [message]
        // The assistant keeps helping until a person joins or is requested.
        if (!agent && nextStatus === 'OPEN') messages.push(await addAssistantReply(transaction, ticket, body.data.body))
        if (agent) {
          await notifyUsers(transaction, [ticket.userId], { type: 'SYSTEM', title: `${request.user.firstName} from DOORSTEP replied`, body: body.data.body, link: SUPPORT_LINK[ticket.user.role] || '/account/support' })
        } else if (nextStatus !== 'OPEN') {
          await notifyAdmins(transaction, { type: 'SYSTEM', title: `New message · ${ticket.ticketNumber}`, body: `${ticket.user.firstName}: ${body.data.body}`, link: `/admin/support?ticket=${ticket.id}` })
        }
        return messages
      })
      return response.status(201).json({ messages: await withSenderNames(created), message: created[0] })
    } catch (error) { return fail(response, error) }
  })

  // "Talk to a person": stops the assistant and alerts the team.
  router.post('/support/tickets/:ticketId/handoff', requireUser, postLimiter, async (request, response) => {
    try {
      const ticket = await loadTicket(request.params.ticketId, request.user)
      if (ticket.userId !== request.user.id) return response.status(403).json({ error: 'OWNER_ONLY' })
      if (ticket.status === 'WITH_AGENT' || ticket.status === 'WAITING_AGENT') return response.json({ status: ticket.status, messages: [] })
      const message = await prisma.$transaction(async (transaction) => {
        await transaction.supportTicket.update({ where: { id: ticket.id }, data: { status: 'WAITING_AGENT', lastMessageAt: new Date(), resolvedAt: null } })
        const note = await transaction.supportMessage.create({ data: { ticketId: ticket.id, senderType: 'SYSTEM', body: 'You asked to talk to a person. Someone from the DOORSTEP team will reply here, and we will notify you when they do.' } })
        await notifyAdmins(transaction, { type: 'SYSTEM', title: `${ticket.user.firstName} wants to talk to a person`, body: `${ticket.ticketNumber} · ${ticket.description.slice(0, 140)}`, link: `/admin/support?ticket=${ticket.id}` })
        return note
      })
      return response.json({ status: 'WAITING_AGENT', messages: await withSenderNames([message]) })
    } catch (error) { return fail(response, error) }
  })

  router.patch('/support/tickets/:ticketId', requireUser, async (request, response) => {
    if (!isAdmin(request.user)) return response.status(403).json({ error: 'ADMIN_ROLE_REQUIRED' })
    const body = z.object({ status: z.enum(STATUSES), resolution: z.string().trim().max(1000).optional() }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'INVALID_TICKET_STATUS' })
    try {
      const ticket = await loadTicket(request.params.ticketId, request.user)
      const resolved = body.data.status === 'RESOLVED'
      const message = await prisma.$transaction(async (transaction) => {
        await transaction.supportTicket.update({ where: { id: ticket.id }, data: { status: body.data.status, resolution: resolved ? body.data.resolution || null : ticket.resolution, resolvedAt: resolved ? new Date() : null, lastMessageAt: new Date() } })
        await transaction.auditLog.create({ data: { actorId: request.user.id, action: `SUPPORT_${body.data.status}`, entityType: 'SupportTicket', entityId: ticket.id, metadata: { resolution: body.data.resolution || null } } })
        if (!resolved) return null
        await notifyUsers(transaction, [ticket.userId], { type: 'SYSTEM', title: 'Your help request was resolved', body: body.data.resolution || `${ticket.ticketNumber} is marked as resolved. Reply in the chat if you still need help.`, link: SUPPORT_LINK[ticket.user.role] || '/account/support' })
        return transaction.supportMessage.create({ data: { ticketId: ticket.id, senderType: 'SYSTEM', body: body.data.resolution ? `Marked as resolved: ${body.data.resolution}` : 'This conversation was marked as resolved. Reply here any time to reopen it.' } })
      })
      return response.json({ status: body.data.status, messages: message ? await withSenderNames([message]) : [] })
    } catch (error) { return fail(response, error) }
  })

  // Photos sent in the chat. Only the ticket owner and admins can open them.
  router.get('/support/messages/:messageId/attachments/:index', requireUser, async (request, response) => {
    try {
      const message = await prisma.supportMessage.findUnique({ where: { id: request.params.messageId }, include: { ticket: { select: { userId: true } } } })
      if (!message || (!isAdmin(request.user) && message.ticket.userId !== request.user.id)) return response.status(404).json({ error: 'ATTACHMENT_NOT_FOUND' })
      const key = Array.isArray(message.attachments) ? message.attachments[Number(request.params.index)] : null
      if (!key) return response.status(404).json({ error: 'ATTACHMENT_NOT_FOUND' })
      const document = await readPrivateDocument(key)
      response.set({ 'Content-Type': document.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
      return response.send(document.buffer)
    } catch (error) { return fail(response, error) }
  })

  return router
}

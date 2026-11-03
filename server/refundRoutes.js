import { Router } from 'express'
import { z } from 'zod'
import { naira } from './financeService.js'
import { notifyUsers } from './notify.js'

// Admin › Money › Refunds to send. Some refunds can't go back automatically — bank-transfer payments, duplicate or
// late payments, and Paystack refunds that failed. Each leaves a "refund required" record on the payment; this
// lists the ones not yet handled and lets an admin record the bank payment, which tells the customer.

export const REFUND_NEEDED = ['REFUND_REQUIRED', 'DUPLICATE_PAYMENT_REFUND_REQUIRED', 'REFUND_FAILED', 'LATE_PAYMENT_REFUND_FAILED']
export const REFUND_HANDLED = ['REFUND_INITIATED', 'LATE_PAYMENT_REFUND_INITIATED', 'REFUND_RECORDED_MANUALLY']

/** Payments whose latest refund need came after their latest refund action (or that were never handled). */
export function openRefunds(transactions) {
  const byPayment = new Map()
  for (const row of transactions) {
    const entry = byPayment.get(row.paymentId) || { needed: null, handled: null }
    if (REFUND_NEEDED.includes(row.type) && (!entry.needed || row.createdAt > entry.needed.createdAt)) entry.needed = row
    if (REFUND_HANDLED.includes(row.type) && (!entry.handled || row.createdAt > entry.handled.createdAt)) entry.handled = row
    byPayment.set(row.paymentId, entry)
  }
  return [...byPayment.entries()].filter(([, entry]) => entry.needed && (!entry.handled || entry.handled.createdAt < entry.needed.createdAt)).map(([paymentId, entry]) => ({ paymentId, needed: entry.needed }))
}

export async function countOpenRefunds(db) {
  const rows = await db.transaction.findMany({ where: { type: { in: [...REFUND_NEEDED, ...REFUND_HANDLED] } }, select: { paymentId: true, type: true, createdAt: true }, take: 5000 })
  return openRefunds(rows).length
}

const who = (customer) => customer ? { name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer', phone: customer.phone || null, email: customer.email || null } : null

export function createRefundRouter({ prisma, requireUser, requireAdmin }) {
  const router = Router()

  router.get('/admin/refunds', requireUser, requireAdmin, async (_request, response) => {
    try {
      const rows = await prisma.transaction.findMany({ where: { type: { in: [...REFUND_NEEDED, ...REFUND_HANDLED] } }, select: { paymentId: true, type: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5000 })
      const open = openRefunds(rows)
      const payments = open.length ? await prisma.payment.findMany({
        where: { id: { in: open.map((entry) => entry.paymentId) } },
        include: {
          order: { select: { orderNumber: true, cancellationReason: true, restaurant: { select: { name: true } }, customer: { select: { firstName: true, lastName: true, phone: true, email: true } } } },
          parcelBooking: { select: { reference: true, customer: { select: { firstName: true, lastName: true, phone: true, email: true } } } },
          transactions: { where: { type: 'TRANSFER_RECEIPT_UPLOADED' }, orderBy: { createdAt: 'desc' }, take: 1, select: { metadata: true } },
        },
      }) : []
      const neededFor = new Map(open.map((entry) => [entry.paymentId, entry.needed]))
      return response.json({
        refunds: payments.map((payment) => {
          const needed = neededFor.get(payment.id)
          const sender = payment.transactions[0]?.metadata || null
          return {
            paymentId: payment.id,
            amountMinor: payment.amountMinor,
            method: payment.method,
            reference: payment.reference,
            neededAt: needed.createdAt,
            why: needed.type.endsWith('REFUND_FAILED') ? 'Paystack couldn’t refund it automatically' : needed.type === 'DUPLICATE_PAYMENT_REFUND_REQUIRED' ? 'Paid twice' : payment.order?.cancellationReason || 'Cancelled after payment',
            label: payment.order ? `${payment.order.orderNumber} · ${payment.order.restaurant?.name || ''}`.trim() : payment.parcelBooking ? `Package ${payment.parcelBooking.reference}` : payment.reference,
            customer: who(payment.order?.customer || payment.parcelBooking?.customer),
            paidFrom: sender ? { name: sender.senderName || null, bank: sender.senderBank || null } : null,
          }
        }).sort((a, b) => new Date(a.neededAt) - new Date(b.neededAt)),
      })
    } catch { return response.status(503).json({ error: 'REFUNDS_UNAVAILABLE' }) }
  })

  // The admin sent the money back from DOORSTEP's bank: record it and tell the customer.
  router.post('/admin/refunds/:paymentId/record', requireUser, requireAdmin, async (request, response) => {
    const body = z.object({ bankReference: z.string().trim().min(3, 'Enter the bank reference.').max(120), note: z.string().trim().max(500).optional() }).safeParse(request.body || {})
    if (!body.success) return response.status(400).json({ error: 'INVALID_REFUND', message: body.error.issues[0]?.message })
    try {
      const payment = await prisma.payment.findUnique({ where: { id: request.params.paymentId }, include: { order: { select: { orderNumber: true, customerId: true } }, parcelBooking: { select: { reference: true, customerId: true } } } })
      if (!payment) return response.status(404).json({ error: 'PAYMENT_NOT_FOUND' })
      const rows = await prisma.transaction.findMany({ where: { paymentId: payment.id, type: { in: [...REFUND_NEEDED, ...REFUND_HANDLED] } }, select: { paymentId: true, type: true, createdAt: true } })
      if (!openRefunds(rows).length) return response.status(409).json({ error: 'REFUND_NOT_OPEN', message: 'This refund has already been handled. Refresh.' })
      await prisma.$transaction(async (transaction) => {
        await transaction.transaction.create({ data: { paymentId: payment.id, type: 'REFUND_RECORDED_MANUALLY', amountMinor: payment.amountMinor, providerReference: body.data.bankReference, metadata: { note: body.data.note || null, recordedBy: request.user.id } } })
        await transaction.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } })
        await transaction.auditLog.create({ data: { actorId: request.user.id, action: 'REFUND_RECORDED_MANUALLY', entityType: 'Payment', entityId: payment.id, metadata: { amountMinor: payment.amountMinor, bankReference: body.data.bankReference, note: body.data.note || null } } })
        const customerId = payment.order?.customerId || payment.parcelBooking?.customerId
        const label = payment.order?.orderNumber || payment.parcelBooking?.reference || payment.reference
        if (customerId) await notifyUsers(transaction, [customerId], { type: 'PAYMENT', title: `Refund of ${naira(payment.amountMinor)} sent`, body: `DOORSTEP sent your refund for ${label} (bank ref ${body.data.bankReference}). Banks usually show it within a day. If it doesn’t arrive, reply in Help.`, link: '/help' })
      })
      return response.json({ recorded: true })
    } catch { return response.status(503).json({ error: 'REFUNDS_UNAVAILABLE', message: 'Could not record the refund. Try again.' }) }
  })

  return router
}

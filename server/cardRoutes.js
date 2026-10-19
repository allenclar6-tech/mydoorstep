import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { CardError, chargeSavedCard, deactivateAuthorization, isExpired, publicCard, refundTransaction, saveCardFromAuthorization, savedCardsEnabled } from './cardService.js'
import { initializePayment, PaymentError, paystackMode, verifyPaystackTransaction } from './paymentService.js'

const verificationAmount = () => {
  const value = Number(process.env.CARD_VERIFICATION_AMOUNT_MINOR || 5000)
  return Number.isSafeInteger(value) && value >= 5000 && value <= 20000 ? value : 5000
}

const fail = (response, error, fallback) => {
  if (error instanceof CardError || error instanceof PaymentError || (error?.code && error?.status)) return response.status(error.status || 503).json({ error: error.code, message: error.message })
  console.error('[cards] unexpected_failure', JSON.stringify({ name: error?.name, code: error?.code }))
  return response.status(503).json({ error: fallback })
}

/**
 * Finishes an "add a card" verification once Paystack has confirmed it: saves the card
 * and refunds the verification charge. Idempotent per reference.
 */
export async function completeCardVerification(prisma, verification, verified, source, { fetchImpl } = {}) {
  if (verification.status === 'SUCCEEDED') return { status: 'SUCCEEDED', savedCardId: verification.savedCardId, duplicate: true }
  if (verified.status !== 'success') {
    if (verified.status === 'failed') await prisma.cardVerification.updateMany({ where: { id: verification.id, status: 'PENDING' }, data: { status: 'FAILED', completedAt: new Date() } })
    return { status: verified.status === 'failed' ? 'FAILED' : 'PENDING' }
  }
  if (verified.reference !== verification.reference || verified.amount !== verification.amountMinor || verified.currency !== 'NGN') {
    await prisma.cardVerification.updateMany({ where: { id: verification.id, status: 'PENDING' }, data: { status: 'MISMATCH', completedAt: new Date() } })
    return { status: 'MISMATCH' }
  }
  const claimed = await prisma.cardVerification.updateMany({ where: { id: verification.id, status: 'PENDING' }, data: { status: 'PROCESSING' } })
  if (claimed.count !== 1) return { status: 'PROCESSING', duplicate: true }
  const card = await saveCardFromAuthorization(prisma, verification.userId, { authorization: verified.authorization, customerEmail: verified.customerEmail, channel: verified.channel })
  const refundStatus = await refundTransaction(verification.reference, { fetchImpl }).catch(() => 'failed')
  await prisma.cardVerification.update({ where: { id: verification.id }, data: { status: card ? 'SUCCEEDED' : 'NOT_REUSABLE', savedCardId: card?.id || null, refundStatus, completedAt: new Date() } })
  if (refundStatus === 'failed') {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true }, take: 20 })
    if (admins.length) await prisma.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, type: 'PAYMENT', title: 'Card verification refund failed', body: `Refund the ₦${verification.amountMinor / 100} card verification ${verification.reference} manually in Paystack.` })) })
  }
  console.info('[cards] verification_completed', JSON.stringify({ source, saved: Boolean(card), refundStatus }))
  return { status: card ? 'SUCCEEDED' : 'NOT_REUSABLE', savedCardId: card?.id || null, refundStatus }
}

/**
 * Routes for listing, adding, removing and paying with saved cards.
 * `applyVerifiedPayment(payment, verified, source, expectedReference)` is supplied by the API
 * so order and parcel payments are confirmed by exactly the same code as webhooks.
 */
export function createCardRouter({ prisma, requireUser, applyVerifiedPayment, rotatePaymentReference, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  const router = Router()
  const limiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'CARD_RATE_LIMITED', message: 'Too many card requests. Wait a minute and try again.' }) })
  const requireCustomer = (request, response, next) => request.user.role === 'CUSTOMER' ? next() : response.status(403).json({ error: 'CUSTOMER_ROLE_REQUIRED' })

  router.get('/cards', requireUser, requireCustomer, async (request, response) => {
    try {
      const cards = await prisma.savedCard.findMany({ where: { userId: request.user.id, removedAt: null }, orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }] })
      return response.json({ enabled: savedCardsEnabled(), mode: paystackMode(), verificationAmountMinor: verificationAmount(), cards: cards.map(publicCard) })
    } catch (error) { return fail(response, error, 'CARD_SERVICE_UNAVAILABLE') }
  })

  router.post('/cards/add', requireUser, requireCustomer, limiter, async (request, response) => {
    try {
      if (!savedCardsEnabled()) throw new CardError('SAVED_CARDS_NOT_CONFIGURED', 'Saving cards is not available yet.', 503)
      const reference = `DSPCARD-${randomUUID()}`
      const amountMinor = verificationAmount()
      await prisma.cardVerification.create({ data: { reference, userId: request.user.id, amountMinor } })
      const initialized = await initializePayment({ email: request.user.email, amountMinor, reference, callbackUrl: process.env.PAYMENT_CALLBACK_URL, metadata: { purpose: 'card_verification' }, channels: ['card'] })
      return response.json({ authorizationUrl: initialized.authorizationUrl, reference, amountMinor })
    } catch (error) { return fail(response, error, 'CARD_SERVICE_UNAVAILABLE') }
  })

  router.delete('/cards/:cardId', requireUser, requireCustomer, async (request, response) => {
    try {
      const card = await prisma.savedCard.findFirst({ where: { id: request.params.cardId, userId: request.user.id, removedAt: null } })
      if (!card) return response.status(404).json({ error: 'CARD_NOT_FOUND' })
      await prisma.savedCard.update({ where: { id: card.id }, data: { removedAt: new Date(), authorizationCipher: 'removed' } })
      // Also ask Paystack to retire the token; the card is unusable here either way.
      deactivateAuthorization(card, { fetchImpl }).catch(() => undefined)
      return response.status(204).end()
    } catch (error) { return fail(response, error, 'CARD_SERVICE_UNAVAILABLE') }
  })

  router.post('/payments/charge-saved-card', requireUser, requireCustomer, limiter, async (request, response) => {
    const result = z.object({ kind: z.enum(['order', 'parcel']), id: z.string().min(1).max(64), cardId: z.string().min(1).max(64) }).safeParse(request.body)
    if (!result.success) return response.status(400).json({ error: 'INVALID_SAVED_CARD_PAYMENT' })
    try {
      if (!savedCardsEnabled()) throw new CardError('SAVED_CARDS_NOT_CONFIGURED', 'Paying with a saved card is not available yet.', 503)
      const card = await prisma.savedCard.findFirst({ where: { id: result.data.cardId, userId: request.user.id, removedAt: null } })
      if (!card) throw new CardError('CARD_NOT_FOUND', 'That card is no longer saved.', 404)
      if (isExpired(card)) throw new CardError('CARD_EXPIRED', 'That card has expired. Use another card.', 409)
      const owner = result.data.kind === 'parcel'
        ? await prisma.parcelBooking.findFirst({ where: { id: result.data.id, customerId: request.user.id }, include: { payment: true } })
        : await prisma.order.findFirst({ where: { id: result.data.id, customerId: request.user.id }, include: { payment: true } })
      const payment = owner?.payment
      if (!payment) throw new CardError('PAYMENT_NOT_FOUND', 'Payment not found.', 404)
      if (payment.method !== 'PAYSTACK') throw new CardError('PAYMENT_METHOD_MISMATCH', 'This order uses a different payment method.', 409)
      if (payment.status === 'SUCCESSFUL') return response.json({ status: 'SUCCESSFUL' })
      const payable = result.data.kind === 'parcel' ? owner.status === 'PENDING_PAYMENT' : ['PENDING_PAYMENT'].includes(owner.status)
      if (!payable) throw new CardError('NOT_PAYABLE', 'This booking can no longer be paid.', 409)
      // A fresh reference avoids clashing with any checkout page already opened for this payment.
      const current = await rotatePaymentReference(prisma, payment, 'saved_card_attempt', result.data.kind === 'parcel' ? 'DSPPKG' : 'DSPORD')
      const charged = await chargeSavedCard(card, { amountMinor: current.amountMinor, reference: current.reference, metadata: { kind: result.data.kind, id: result.data.id, savedCard: true } }, { fetchImpl })
      await prisma.savedCard.update({ where: { id: card.id }, data: { lastUsedAt: new Date() } })
      if (charged.status !== 'success') {
        // Paystack may still be processing; the webhook will confirm it if it succeeds.
        return response.json({ status: charged.status === 'failed' ? 'FAILED' : 'PENDING', providerStatus: charged.status, message: charged.status === 'failed' ? (charged.gatewayResponse ? `Card declined: ${charged.gatewayResponse}` : 'The card was declined.') : 'Paystack is still processing this payment.' })
      }
      const outcome = await applyVerifiedPayment(current, charged, 'saved_card', current.reference)
      const refreshed = await prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } })
      return response.json({ status: refreshed.status, ...(outcome?.refundRequired ? { refundReview: true } : {}) })
    } catch (error) { return fail(response, error, 'PAYMENT_SERVICE_UNAVAILABLE') }
  })

  return router
}

export { verifyPaystackTransaction }

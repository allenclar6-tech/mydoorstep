import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { naira } from './financeService.js'
import { notifyAdmins, notifyUsers } from './notify.js'
import { fetchRecipient } from './paystackPayouts.js'
import { transfersEnabled } from './payoutEngine.js'
import { getPayoutSettings } from './payoutSettings.js'
import { createWithdrawalRequest, earningsLink, markRequestPaid, payeeOf, payeeUserIds, releaseRequest, REQUESTED, sendRequestByPaystack, withdrawalOptions } from './withdrawalRequests.js'

// HTTP routes for withdrawals (logic and rules live in withdrawalRequests.js).

async function paystackBalance(fetchImpl = globalThis.fetch) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) return null
  try {
    const response = await fetchImpl('https://api.paystack.co/balance', { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.status) return { error: body?.message || 'Paystack did not return a balance.' }
    const ngn = (body.data || []).find((row) => row.currency === 'NGN') || body.data?.[0]
    return ngn ? { balanceMinor: ngn.balance, currency: ngn.currency } : { error: 'No NGN balance found.' }
  } catch { return { error: 'Paystack could not be reached.' } }
}

export function createWithdrawalRouter({ prisma, requireUser, requireAdmin, fetchImpl }) {
  const router = Router()
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many withdrawal attempts. Wait a few minutes.' }) })
  const fail = (response, error) => {
    if (error?.code && error?.status) return response.status(error.status).json({ error: error.code, message: error.message })
    if (error?.name === 'ZodError') return response.status(400).json({ error: 'INVALID_REQUEST', message: error.issues?.[0]?.message })
    console.error('[withdrawals] unexpected_failure', JSON.stringify({ name: error?.name, code: error?.code }))
    return response.status(503).json({ error: 'WITHDRAWAL_SERVICE_UNAVAILABLE', message: 'Withdrawals are unavailable right now. Try again shortly.' })
  }

  /* ------------------------------- partner side ------------------------------- */
  router.get('/finance/withdrawal-options', requireUser, async (request, response) => {
    try {
      const { entryIds, ...options } = await withdrawalOptions(prisma, await payeeOf(prisma, request.user))
      return response.json(options)
    } catch (error) { return fail(response, error) }
  })
  router.post('/finance/withdrawal-requests', requireUser, limiter, async (request, response) => {
    try {
      const who = await payeeOf(prisma, request.user)
      const body = z.object({ amountMinor: z.number().int().positive().max(1_000_000_000).optional() }).parse(request.body || {})
      const options = await withdrawalOptions(prisma, who)
      const created = await createWithdrawalRequest(prisma, who, { actorId: request.user.id, amountMinor: body.amountMinor ?? null })
      // Instant mode (Paystack Transfers + "Cash out now" on): send it straight away instead of waiting for approval.
      const payout = options.mode === 'INSTANT' ? await sendRequestByPaystack(prisma, created.id, { actorId: request.user.id, fetchImpl }).catch(async (error) => { console.error('[withdrawals] instant send failed', error?.code); return prisma.payout.findUnique({ where: { id: created.id } }) }) : created
      return response.status(201).json({ request: { id: payout.id, amountMinor: payout.amountMinor, feeMinor: payout.feeMinor, status: payout.status, instant: options.mode === 'INSTANT' } })
    } catch (error) { return fail(response, error) }
  })
  router.post('/finance/withdrawal-requests/:payoutId/cancel', requireUser, async (request, response) => {
    try {
      const who = await payeeOf(prisma, request.user)
      const payout = await prisma.payout.findFirst({ where: { id: request.params.payoutId, ...who.owner, source: 'WITHDRAWAL' } })
      if (!payout) return response.status(404).json({ error: 'REQUEST_NOT_FOUND' })
      const released = await releaseRequest(prisma, payout.id, { reason: 'Cancelled by the partner', actorId: request.user.id, action: 'WITHDRAWAL_CANCELLED_BY_PARTNER' })
      if (!released) return response.status(409).json({ error: 'ALREADY_HANDLED', message: 'DOORSTEP has already started sending this money, so it can’t be cancelled.' })
      await notifyAdmins(prisma, { type: 'PAYMENT', title: 'Withdrawal request cancelled', body: `${who.name} cancelled their ${naira(payout.amountMinor)} withdrawal request.`, link: '/admin/finance' })
      return response.json({ cancelled: true })
    } catch (error) { return fail(response, error) }
  })

  /* -------------------------------- admin side -------------------------------- */
  router.get('/admin/finance/withdrawal-requests', requireUser, requireAdmin, async (request, response) => {
    try {
      const rows = await prisma.payout.findMany({ where: { source: 'WITHDRAWAL', status: REQUESTED }, orderBy: { createdAt: 'asc' }, take: 100 })
      const restaurantIds = rows.map((row) => row.restaurantId).filter(Boolean)
      const riderIds = rows.map((row) => row.riderId).filter(Boolean)
      const [restaurants, riders, accounts] = await Promise.all([
        restaurantIds.length ? prisma.restaurant.findMany({ where: { id: { in: restaurantIds } }, select: { id: true, name: true, phone: true } }) : [],
        riderIds.length ? prisma.rider.findMany({ where: { id: { in: riderIds } }, select: { id: true, user: { select: { firstName: true, lastName: true, phone: true } } } }) : [],
        prisma.payoutAccount.findMany({ where: { OR: [{ restaurantId: { in: restaurantIds } }, { riderId: { in: riderIds } }] } }),
      ])
      const requests = []
      for (const row of rows) {
        const account = accounts.find((entry) => (row.riderId && entry.riderId === row.riderId) || (row.restaurantId && entry.restaurantId === row.restaurantId))
        let accountNumber = null
        if (account?.paystackRecipientCode) { try { accountNumber = (await fetchRecipient(account.paystackRecipientCode, { fetchImpl })).accountNumber } catch { accountNumber = null } }
        const business = restaurants.find((entry) => entry.id === row.restaurantId)
        const rider = riders.find((entry) => entry.id === row.riderId)
        requests.push({
          id: row.id, party: row.party, amountMinor: row.amountMinor, feeMinor: row.feeMinor, createdAt: row.createdAt, reference: row.reference,
          name: business?.name || `${rider?.user.firstName || ''} ${rider?.user.lastName || ''}`.trim() || 'Partner',
          phone: business?.phone || rider?.user.phone || null,
          bank: account ? { bankName: account.bankName, accountName: account.accountName, accountNumber, last4: account.accountLast4 } : row.bankSnapshot,
        })
      }
      if (requests.length) await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'WITHDRAWAL_REQUESTS_VIEWED', entityType: 'Payout', entityId: 'queue', metadata: { count: requests.length } } })
      return response.json({ requests, transfersEnabled: transfersEnabled() })
    } catch (error) { return fail(response, error) }
  })
  router.post('/admin/finance/withdrawal-requests/:payoutId/send', requireUser, requireAdmin, async (request, response) => {
    try {
      const payout = await sendRequestByPaystack(prisma, request.params.payoutId, { actorId: request.user.id, fetchImpl })
      return response.json({ payout: { id: payout.id, status: payout.status, amountMinor: payout.amountMinor } })
    } catch (error) { return fail(response, error) }
  })
  router.post('/admin/finance/withdrawal-requests/:payoutId/paid', requireUser, requireAdmin, async (request, response) => {
    try {
      const body = z.object({ bankReference: z.string().trim().min(3, 'Enter the bank transaction / session ID.').max(160), note: z.string().trim().max(500).optional() }).parse(request.body || {})
      const payout = await markRequestPaid(prisma, request.params.payoutId, { ...body, actorId: request.user.id })
      if (!payout) return response.status(409).json({ error: 'ALREADY_HANDLED', message: 'This request was already handled. Refresh.' })
      return response.json({ payout: { id: payout.id, status: payout.status } })
    } catch (error) { return fail(response, error) }
  })
  router.post('/admin/finance/withdrawal-requests/:payoutId/decline', requireUser, requireAdmin, async (request, response) => {
    try {
      const body = z.object({ reason: z.string().trim().min(3, 'Tell the partner why.').max(300) }).parse(request.body || {})
      const payout = await releaseRequest(prisma, request.params.payoutId, { reason: `Declined by DOORSTEP: ${body.reason}`, actorId: request.user.id, action: 'WITHDRAWAL_DECLINED' })
      if (!payout) return response.status(409).json({ error: 'ALREADY_HANDLED', message: 'This request was already handled. Refresh.' })
      await notifyUsers(prisma, await payeeUserIds(prisma, payout), { type: 'PAYMENT', title: 'Withdrawal not approved', body: `${body.reason}. The ${naira(payout.amountMinor + payout.feeMinor)} is back in your balance and no fee was charged.`, link: earningsLink(payout.party) })
      return response.json({ declined: true })
    } catch (error) { return fail(response, error) }
  })

  // "Can partners be paid straight to their bank?" — a checklist with the live Paystack balance.
  router.get('/admin/finance/payout-readiness', requireUser, requireAdmin, async (_request, response) => {
    try {
      const [settings, balance, businesses, riders, businessAccounts, riderAccounts, splitAccounts, owed] = await Promise.all([
        getPayoutSettings(prisma),
        paystackBalance(fetchImpl),
        prisma.restaurant.count({ where: { status: 'APPROVED' } }),
        prisma.rider.count({ where: { status: 'APPROVED', network: 'DOORSTEP_POOL' } }),
        prisma.payoutAccount.count({ where: { restaurantId: { not: null }, status: 'ACTIVE', paystackRecipientCode: { not: null } } }),
        prisma.payoutAccount.count({ where: { riderId: { not: null }, status: 'ACTIVE', paystackRecipientCode: { not: null } } }),
        prisma.payoutAccount.count({ where: { restaurantId: { not: null }, paystackSubaccountCode: { not: null } } }),
        prisma.ledgerEntry.aggregate({ where: { party: { in: ['RESTAURANT', 'RIDER'] }, status: 'DUE' }, _sum: { amountMinor: true } }),
      ])
      return response.json({
        paystackKey: Boolean(process.env.PAYSTACK_SECRET_KEY),
        transfersEnabled: transfersEnabled(),
        balance,
        owedMinor: Math.max(0, owed._sum.amountMinor || 0),
        modes: { businesses: settings.businesses.mode, riders: settings.riders.mode },
        withdrawals: settings.withdrawals,
        accounts: { businesses, businessAccounts, splitAccounts, riders, riderAccounts },
      })
    } catch (error) { return fail(response, error) }
  })
  return router
}

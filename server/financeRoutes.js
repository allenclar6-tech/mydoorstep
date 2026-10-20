import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { naira } from './financeService.js'
import { FINANCE_SETTINGS_KEY, financeSettingsSchema, getFinanceSettings } from './financeSettings.js'
import { balancesDue } from './financeLedger.js'
import { createRecipient, listBanks, maskAccount, PayoutError, resolveAccount, sendTransfer, transferCertainlyNotSent, upsertSubaccount, verifyTransfer } from './paystackPayouts.js'
import { notifyAdmins, notifyUsers, restaurantTeamIds } from './notify.js'

const transfersEnabled = () => process.env.PAYSTACK_TRANSFERS_ENABLED === 'true' && Boolean(process.env.PAYSTACK_SECRET_KEY)

/** Applies a Paystack transfer result (webhook or verify) to a payout and its ledger entries. Idempotent. */
export async function applyTransferResult(prisma, reference, status, reason = null) {
  const payout = await prisma.payout.findUnique({ where: { reference } })
  if (!payout || payout.status === 'PAID' || payout.status === 'FAILED') return payout
  if (status === 'success') {
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.payout.updateMany({ where: { id: payout.id, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'PAID', completedAt: new Date(), failureReason: null } })
      if (changed.count !== 1) return
      await transaction.ledgerEntry.updateMany({ where: { payoutId: payout.id, status: 'PAYING' }, data: { status: 'PAID' } })
      const userIds = payout.riderId ? [(await transaction.rider.findUnique({ where: { id: payout.riderId }, select: { userId: true } }))?.userId] : await restaurantTeamIds(transaction, payout.restaurantId)
      await notifyUsers(transaction, userIds, { type: 'PAYMENT', title: `Payout of ${naira(payout.amountMinor)} sent`, body: 'DOORSTEP sent your earnings to your bank. Banks usually credit within minutes.', link: payout.riderId ? '/rider/earnings' : '/restaurant/earnings' })
    })
  } else if (['failed', 'reversed', 'abandoned', 'blocked', 'rejected'].includes(status)) {
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.payout.updateMany({ where: { id: payout.id, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED', completedAt: new Date(), failureReason: reason || status } })
      if (changed.count !== 1) return
      // The money was not sent, so it is owed again.
      await transaction.ledgerEntry.updateMany({ where: { payoutId: payout.id, status: 'PAYING' }, data: { status: 'DUE', payoutId: null } })
      await notifyAdmins(transaction, { type: 'PAYMENT', title: 'Payout failed', body: `${naira(payout.amountMinor)} transfer ${payout.reference} ${status}${reason ? `: ${reason}` : ''}. The amount is owed again.`, link: '/admin/finance' })
    })
  }
  return prisma.payout.findUnique({ where: { reference } })
}

export function createFinanceRouter({ prisma, requireUser, requireAdmin, verifyPassword, fetchImpl }) {
  const router = Router()
  const resolveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many account checks. Wait a few minutes.' }) })
  const fail = (response, error) => {
    if (error instanceof PayoutError || (error?.code && error?.status)) return response.status(error.status || 400).json({ error: error.code, message: error.message })
    if (error?.name === 'ZodError') return response.status(400).json({ error: 'INVALID_REQUEST', message: error.issues?.[0]?.message })
    console.error('[finance] unexpected_failure', JSON.stringify({ name: error?.name, code: error?.code }))
    return response.status(503).json({ error: 'FINANCE_SERVICE_UNAVAILABLE' })
  }

  // Who is asking: a business team member or a rider.
  async function payee(user) {
    if (user.role === 'RIDER' && user.rider) return { kind: 'RIDER', riderId: user.rider.id, name: `${user.firstName} ${user.lastName}`.trim(), where: { riderId: user.rider.id } }
    if (user.role === 'RESTAURANT') {
      const membership = await prisma.restaurantUser.findFirst({ where: { userId: user.id }, include: { restaurant: { select: { id: true, name: true } } } })
      if (membership) return { kind: 'RESTAURANT', restaurantId: membership.restaurant.id, name: membership.restaurant.name, where: { restaurantId: membership.restaurant.id } }
    }
    throw Object.assign(new Error('Only businesses and riders have payouts.'), { code: 'PAYEE_ROLE_REQUIRED', status: 403 })
  }
  const publicAccount = (account) => account ? { bankName: account.bankName, accountName: account.accountName, accountNumber: `••••${account.accountLast4}`, status: account.status, splitReady: Boolean(account.paystackSubaccountCode), transfersReady: Boolean(account.paystackRecipientCode), verifiedAt: account.verifiedAt, updatedAt: account.updatedAt } : null

  router.get('/finance/banks', requireUser, async (_request, response) => {
    try { return response.json({ banks: await listBanks({ fetchImpl }) }) } catch (error) { return fail(response, error) }
  })

  router.post('/finance/resolve-account', requireUser, resolveLimiter, async (request, response) => {
    try {
      await payee(request.user)
      const body = z.object({ bankCode: z.string().trim().min(3).max(10), accountNumber: z.string().trim().regex(/^\d{10}$/, 'Account numbers have 10 digits.') }).parse(request.body)
      const resolved = await resolveAccount(body, { fetchImpl })
      return response.json({ accountName: resolved.accountName })
    } catch (error) { return fail(response, error) }
  })

  router.get('/finance/payout-account', requireUser, async (request, response) => {
    try {
      const who = await payee(request.user)
      const account = await prisma.payoutAccount.findFirst({ where: who.where })
      return response.json({ account: publicAccount(account), transfersEnabled: transfersEnabled() })
    } catch (error) { return fail(response, error) }
  })

  // Adds or changes where money is paid. Needs the account password; the owner and DOORSTEP admins are told.
  router.put('/finance/payout-account', requireUser, resolveLimiter, async (request, response) => {
    try {
      const who = await payee(request.user)
      const body = z.object({ bankCode: z.string().trim().min(3).max(10), bankName: z.string().trim().min(2).max(120), accountNumber: z.string().trim().regex(/^\d{10}$/, 'Account numbers have 10 digits.'), password: z.string().min(1).max(200), confirmedName: z.string().trim().min(2).max(200) }).parse(request.body)
      const fullUser = await prisma.user.findUnique({ where: { id: request.user.id }, select: { passwordHash: true, email: true, phone: true } })
      if (!(await verifyPassword(body.password, fullUser?.passwordHash || null))) return response.status(401).json({ error: 'PASSWORD_INCORRECT', message: 'That password is not correct.' })
      const resolved = await resolveAccount({ accountNumber: body.accountNumber, bankCode: body.bankCode }, { fetchImpl })
      if (resolved.accountName.trim().toUpperCase() !== body.confirmedName.trim().toUpperCase()) return response.status(409).json({ error: 'ACCOUNT_NAME_CHANGED', message: 'The account name changed while you were confirming. Check it again.' })
      const existing = await prisma.payoutAccount.findFirst({ where: who.where })
      const subaccount = who.kind === 'RESTAURANT' ? await upsertSubaccount({ existingCode: existing?.paystackSubaccountCode, businessName: who.name, bankCode: body.bankCode, accountNumber: body.accountNumber, email: fullUser.email, phone: fullUser.phone }, { fetchImpl }) : null
      const recipient = await createRecipient({ name: resolved.accountName, bankCode: body.bankCode, accountNumber: body.accountNumber, ownerRef: who.kind === 'RIDER' ? `rider:${who.riderId}` : `business:${who.restaurantId}` }, { fetchImpl })
      const data = { ownerType: who.kind, bankCode: body.bankCode, bankName: body.bankName, accountName: resolved.accountName, accountLast4: body.accountNumber.slice(-4), paystackSubaccountCode: subaccount?.subaccountCode || null, paystackRecipientCode: recipient.recipientCode, status: 'ACTIVE', verifiedAt: new Date(), updatedById: request.user.id }
      const account = existing
        ? await prisma.payoutAccount.update({ where: { id: existing.id }, data })
        : await prisma.payoutAccount.create({ data: { ...data, ...(who.kind === 'RIDER' ? { riderId: who.riderId } : { restaurantId: who.restaurantId }) } })
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: existing ? 'PAYOUT_ACCOUNT_CHANGED' : 'PAYOUT_ACCOUNT_ADDED', entityType: 'PayoutAccount', entityId: account.id, metadata: { bank: body.bankName, last4: account.accountLast4, previousLast4: existing?.accountLast4 || null } } })
      const owners = who.kind === 'RIDER' ? [request.user.id] : await restaurantTeamIds(prisma, who.restaurantId)
      await notifyUsers(prisma, owners, { type: 'SECURITY', title: existing ? 'Payout bank account changed' : 'Payout bank account added', body: `Payouts now go to ${body.bankName} ${maskAccount(body.accountNumber)} (${resolved.accountName}). If this wasn’t you, contact DOORSTEP support now.`, link: who.kind === 'RIDER' ? '/rider/earnings' : '/restaurant/earnings' })
      await notifyAdmins(prisma, { type: 'SECURITY', title: `${who.name} ${existing ? 'changed' : 'added'} a payout account`, body: `${body.bankName} ${maskAccount(body.accountNumber)} · ${resolved.accountName}`, link: '/admin/finance' })
      return response.json({ account: publicAccount(account) })
    } catch (error) { return fail(response, error) }
  })

  // Earnings summary and statement for the business or rider.
  router.get('/finance/summary', requireUser, async (request, response) => {
    try {
      const who = await payee(request.user)
      const where = { party: who.kind, ...who.where }
      const [grouped, entries, payouts, account] = await Promise.all([
        prisma.ledgerEntry.groupBy({ by: ['status'], where, _sum: { amountMinor: true } }),
        prisma.ledgerEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, type: true, amountMinor: true, status: true, description: true, createdAt: true, orderId: true, parcelBookingId: true } }),
        prisma.payout.findMany({ where: { party: who.kind, ...who.where }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, amountMinor: true, status: true, method: true, createdAt: true, completedAt: true, failureReason: true } }),
        prisma.payoutAccount.findFirst({ where: who.where }),
      ])
      const total = (status) => grouped.find((row) => row.status === status)?._sum.amountMinor || 0
      const settings = await getFinanceSettings(prisma)
      let orders = null
      if (who.kind === 'RESTAURANT') {
        const agg = await prisma.order.aggregate({ where: { restaurantId: who.restaurantId, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED'] } }, _sum: { subtotalMinor: true }, _count: { _all: true } })
        const commission = await prisma.commission.aggregate({ where: { order: { restaurantId: who.restaurantId } }, _sum: { amountMinor: true } })
        orders = { count: agg._count._all, salesMinor: agg._sum.subtotalMinor || 0, commissionMinor: commission._sum.amountMinor || 0 }
      }
      return response.json({
        kind: who.kind,
        account: publicAccount(account),
        balances: { dueMinor: total('DUE'), payingMinor: total('PAYING'), paidMinor: total('PAID'), settledBySplitMinor: total('SETTLED_BY_SPLIT'), awaitingPriceCount: entries.filter((entry) => entry.status === 'NEEDS_REVIEW').length },
        orders,
        rates: { doorstepRiderPercent: settings.commission.doorstepRiderPercent, ownRiderPercent: settings.commission.ownRiderPercent, riderPay: settings.riderPay.enabled ? { bands: settings.riderPay.bands, perKmAfterMinor: settings.riderPay.perKmAfterMinor } : null },
        entries, payouts,
      })
    } catch (error) { return fail(response, error) }
  })

  // Pickup point for distance-based rider pay (business sets it from its workspace).
  router.put('/restaurant/location', requireUser, async (request, response) => {
    try {
      const who = await payee(request.user)
      if (who.kind !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
      const body = z.object({ latitude: z.number().gte(4).lte(14), longitude: z.number().gte(2).lte(15) }).parse(request.body)
      const restaurant = await prisma.restaurant.update({ where: { id: who.restaurantId }, data: body, select: { latitude: true, longitude: true } })
      return response.json({ location: { latitude: Number(restaurant.latitude), longitude: Number(restaurant.longitude) } })
    } catch (error) { return fail(response, error) }
  })

  // ------------------------------- admin -----------------------------------
  router.get('/admin/finance/settings', requireUser, requireAdmin, async (_request, response) => {
    try { return response.json({ settings: await getFinanceSettings(prisma), transfersEnabled: transfersEnabled() }) } catch (error) { return fail(response, error) }
  })

  router.put('/admin/finance/settings', requireUser, requireAdmin, async (request, response) => {
    const parsed = financeSettingsSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_FINANCE_SETTINGS', message: parsed.error.issues[0]?.message, details: parsed.error.flatten() })
    try {
      const previous = await getFinanceSettings(prisma)
      const value = { ...parsed.data, riderPay: { ...parsed.data.riderPay, bands: [...parsed.data.riderPay.bands].sort((a, b) => a.upToKm - b.upToKm) } }
      await prisma.platformSetting.upsert({ where: { key: FINANCE_SETTINGS_KEY }, update: { value }, create: { key: FINANCE_SETTINGS_KEY, value } })
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'FINANCE_SETTINGS_UPDATED', entityType: 'PlatformSetting', entityId: FINANCE_SETTINGS_KEY, metadata: { previous, next: value } } })
      return response.json({ settings: value })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/finance/overview', requireUser, requireAdmin, async (_request, response) => {
    try {
      const [income, balances, reviewCount, payoutsProcessing, accounts] = await Promise.all([
        prisma.ledgerEntry.groupBy({ by: ['type'], where: { party: 'PLATFORM', status: 'RETAINED' }, _sum: { amountMinor: true } }),
        balancesDue(prisma),
        prisma.ledgerEntry.count({ where: { status: 'NEEDS_REVIEW' } }),
        prisma.payout.count({ where: { status: 'PROCESSING' } }),
        prisma.payoutAccount.findMany({ select: { restaurantId: true, riderId: true, bankName: true, accountName: true, accountLast4: true, paystackRecipientCode: true, status: true } }),
      ])
      const restaurantIds = balances.filter((row) => row.restaurantId).map((row) => row.restaurantId)
      const riderIds = balances.filter((row) => row.riderId).map((row) => row.riderId)
      const [restaurants, riders] = await Promise.all([
        restaurantIds.length ? prisma.restaurant.findMany({ where: { id: { in: restaurantIds } }, select: { id: true, name: true } }) : [],
        riderIds.length ? prisma.rider.findMany({ where: { id: { in: riderIds } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }) : [],
      ])
      const incomeBy = Object.fromEntries(income.map((row) => [row.type, row._sum.amountMinor || 0]))
      return response.json({
        transfersEnabled: transfersEnabled(),
        income: { commissionMinor: incomeBy.ORDER_COMMISSION || 0, serviceFeesMinor: incomeBy.SERVICE_FEE || 0, deliveryFeesMinor: incomeBy.DELIVERY_FEE || 0, parcelRevenueMinor: incomeBy.PARCEL_REVENUE || 0 },
        owed: balances.map((row) => {
          const account = accounts.find((entry) => (row.restaurantId && entry.restaurantId === row.restaurantId) || (row.riderId && entry.riderId === row.riderId))
          const name = row.restaurantId ? restaurants.find((entry) => entry.id === row.restaurantId)?.name : (() => { const rider = riders.find((entry) => entry.id === row.riderId); return rider ? `${rider.user.firstName} ${rider.user.lastName}` : null })()
          return { ...row, name: name || 'Unknown', account: account ? { bankName: account.bankName, accountName: account.accountName, last4: account.accountLast4, transfersReady: Boolean(account.paystackRecipientCode) } : null }
        }).sort((a, b) => b.amountMinor - a.amountMinor),
        reviewCount, payoutsProcessing,
      })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/finance/entries', requireUser, requireAdmin, async (request, response) => {
    try {
      const query = z.object({ status: z.string().max(20).optional(), party: z.enum(['PLATFORM', 'RESTAURANT', 'RIDER']).optional() }).parse(request.query)
      const entries = await prisma.ledgerEntry.findMany({ where: { ...(query.status ? { status: query.status } : {}), ...(query.party ? { party: query.party } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 })
      return response.json({ entries })
    } catch (error) { return fail(response, error) }
  })

  // DOORSTEP sets the amount for a rider earning that could not be priced automatically.
  router.post('/admin/finance/entries/:entryId/price', requireUser, requireAdmin, async (request, response) => {
    try {
      const body = z.object({ amountMinor: z.number().int().min(0).max(10_000_000), note: z.string().trim().max(200).optional() }).parse(request.body)
      const entry = await prisma.ledgerEntry.findUnique({ where: { id: request.params.entryId } })
      if (!entry || entry.status !== 'NEEDS_REVIEW') return response.status(409).json({ error: 'NOT_AWAITING_PRICE' })
      const updated = await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { amountMinor: body.amountMinor, status: 'DUE', description: `${entry.description.split(':')[0]} · set by DOORSTEP${body.note ? `: ${body.note}` : ''}` } })
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'RIDER_EARNING_PRICED', entityType: 'LedgerEntry', entityId: entry.id, metadata: { amountMinor: body.amountMinor, note: body.note || null } } })
      if (entry.riderId) {
        const rider = await prisma.rider.findUnique({ where: { id: entry.riderId }, select: { userId: true } })
        if (rider) await notifyUsers(prisma, [rider.userId], { type: 'PAYMENT', title: `You earned ${naira(body.amountMinor)}`, body: `${updated.description}. It is added to your next payout.`, link: '/rider/earnings' })
      }
      return response.json({ entry: updated })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/finance/payouts', requireUser, requireAdmin, async (_request, response) => {
    try { return response.json({ payouts: await prisma.payout.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) }) } catch (error) { return fail(response, error) }
  })

  // Pays what one business or rider is owed: a Paystack Transfer, or a manual bank payment recorded by an admin.
  router.post('/admin/finance/payouts', requireUser, requireAdmin, async (request, response) => {
    try {
      const body = z.object({ restaurantId: z.string().min(1).optional(), riderId: z.string().min(1).optional(), method: z.enum(['PAYSTACK_TRANSFER', 'MANUAL']), manualReference: z.string().trim().min(3).max(80).optional() })
        .refine((value) => Boolean(value.restaurantId) !== Boolean(value.riderId), 'Choose one business or rider.')
        .refine((value) => value.method !== 'MANUAL' || value.manualReference, 'Enter the bank transfer reference for a manual payout.').parse(request.body)
      const party = body.riderId ? 'RIDER' : 'RESTAURANT'
      const owner = body.riderId ? { riderId: body.riderId } : { restaurantId: body.restaurantId }
      const account = await prisma.payoutAccount.findFirst({ where: owner })
      if (body.method === 'PAYSTACK_TRANSFER') {
        if (!transfersEnabled()) return response.status(409).json({ error: 'TRANSFERS_NOT_ENABLED', message: 'Paystack transfers are off. Set PAYSTACK_TRANSFERS_ENABLED=true on the API after enabling Transfers in Paystack, or record a manual payout.' })
        if (!account?.paystackRecipientCode) return response.status(409).json({ error: 'NO_PAYOUT_ACCOUNT', message: 'This payee has not added a verified bank account yet.' })
      }
      const reference = `dsp_payout_${randomUUID().replaceAll('-', '').slice(0, 24)}`
      // Reserve the owed entries atomically so two admins can't pay the same money twice.
      const payout = await prisma.$transaction(async (transaction) => {
        const due = await transaction.ledgerEntry.findMany({ where: { ...owner, party, status: 'DUE' }, select: { id: true, amountMinor: true } })
        const amountMinor = due.reduce((sum, entry) => sum + entry.amountMinor, 0)
        if (amountMinor < 100) throw Object.assign(new Error(amountMinor < 0 ? 'This payee owes DOORSTEP money; nothing to pay out.' : 'Nothing is owed right now.'), { code: 'NOTHING_TO_PAY', status: 409 })
        const created = await transaction.payout.create({ data: { party, ...owner, amountMinor, method: body.method, status: body.method === 'MANUAL' ? 'PAID' : 'PENDING', reference, transferCode: body.manualReference || null, bankSnapshot: account ? { bankName: account.bankName, accountName: account.accountName, last4: account.accountLast4 } : null, createdById: request.user.id, completedAt: body.method === 'MANUAL' ? new Date() : null } })
        const reserved = await transaction.ledgerEntry.updateMany({ where: { id: { in: due.map((entry) => entry.id) }, status: 'DUE' }, data: { status: body.method === 'MANUAL' ? 'PAID' : 'PAYING', payoutId: created.id } })
        if (reserved.count !== due.length) throw Object.assign(new Error('Balances changed while preparing the payout. Try again.'), { code: 'BALANCE_CHANGED', status: 409 })
        await transaction.auditLog.create({ data: { actorId: request.user.id, action: `PAYOUT_${body.method}`, entityType: 'Payout', entityId: created.id, metadata: { amountMinor, entries: due.length, manualReference: body.manualReference || null } } })
        return created
      })
      if (body.method === 'MANUAL') {
        const userIds = body.riderId ? [(await prisma.rider.findUnique({ where: { id: body.riderId }, select: { userId: true } }))?.userId] : await restaurantTeamIds(prisma, body.restaurantId)
        await notifyUsers(prisma, userIds, { type: 'PAYMENT', title: `Payout of ${naira(payout.amountMinor)} sent`, body: `DOORSTEP paid you by bank transfer (ref ${body.manualReference}).`, link: body.riderId ? '/rider/earnings' : '/restaurant/earnings' })
        return response.status(201).json({ payout })
      }
      try {
        const sent = await sendTransfer({ amountMinor: payout.amountMinor, recipientCode: account.paystackRecipientCode, reference, reason: `DOORSTEP payout ${reference.slice(-8)}` }, { fetchImpl })
        if (sent.status === 'success') return response.status(201).json({ payout: await applyTransferResult(prisma, reference, 'success') })
        const otp = sent.status === 'otp'
        const updated = await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING', transferCode: sent.transferCode, failureReason: otp ? 'OTP_REQUIRED: finish it in the Paystack dashboard, or turn off transfer OTP in Paystack → Settings → Preferences' : null } })
        return response.status(201).json({ payout: updated })
      } catch (error) {
        if (transferCertainlyNotSent(error)) {
          await applyTransferResult(prisma, reference, 'failed', error.message)
          throw error
        }
        // Outcome unknown (timeout or Paystack error): keep the entries reserved so nobody pays them again.
        // The transfer webhook or the Refresh button settles it with Paystack's real status.
        const pending = await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING', failureReason: 'UNCONFIRMED: Paystack did not confirm this transfer. Use Refresh to check its status before paying again.' } })
        await notifyAdmins(prisma, { type: 'PAYMENT', title: 'Payout needs checking', body: `${naira(payout.amountMinor)} transfer ${reference} was not confirmed by Paystack. Press Refresh on it before paying again.`, link: '/admin/finance' }).catch(() => undefined)
        return response.status(202).json({ payout: pending, unconfirmed: true })
      }
    } catch (error) { return fail(response, error) }
  })

  router.post('/admin/finance/payouts/:payoutId/refresh', requireUser, requireAdmin, async (request, response) => {
    try {
      const payout = await prisma.payout.findUnique({ where: { id: request.params.payoutId } })
      if (!payout || payout.method !== 'PAYSTACK_TRANSFER') return response.status(404).json({ error: 'PAYOUT_NOT_FOUND' })
      const result = await verifyTransfer(payout.reference, { fetchImpl })
      return response.json({ payout: await applyTransferResult(prisma, payout.reference, result.status, result.reason) })
    } catch (error) { return fail(response, error) }
  })

  return router
}

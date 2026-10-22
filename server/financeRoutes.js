import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { naira } from './financeService.js'
import { FINANCE_SETTINGS_KEY, financeSettingsSchema, getFinanceSettings } from './financeSettings.js'
import { balancesDue, riderFeeSource } from './financeLedger.js'
import { riderFeeEntries } from './financeService.js'
import multer from 'multer'
import { createRecipient, fetchRecipient, listBanks, maskAccount, PayoutError, resolveAccount, upsertSubaccount, verifyTransfer } from './paystackPayouts.js'
import { applyTransferResult, availableBalance, confirmPayout, createPayout, disputePayout, markScheduleRun, payParty, resolvePayout, transfersEnabled } from './payoutEngine.js'
import { readPrivateDocument, storePrivateDocument } from './uploadService.js'
import { getPayoutSettings, lastScheduledMoment, nextScheduledMoment, PAYOUT_SETTINGS_KEY, payoutSettingsSchema, ruleFor, startOfLagosDay, withdrawalFee } from './payoutSettings.js'
import { notifyAdmins, notifyUsers, restaurantTeamIds } from './notify.js'

export { applyTransferResult } from './payoutEngine.js'

const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('receipt')

export function createFinanceRouter({ prisma, requireUser, requireAdmin, verifyPassword, fetchImpl }) {
  const router = Router()
  const withdrawLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many cash-out attempts. Wait a few minutes.' }) })
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
        prisma.payout.findMany({ where: { party: who.kind, ...who.where }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, amountMinor: true, feeMinor: true, source: true, status: true, method: true, transferCode: true, bankSnapshot: true, receiptKey: true, disputeNote: true, createdAt: true, completedAt: true, failureReason: true } }),
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
      const payoutSettings = await getPayoutSettings(prisma)
      const rule = ruleFor(payoutSettings, who.kind)
      const now = new Date()
      const [balance, cashOutsToday] = await Promise.all([
        availableBalance(prisma, { party: who.kind, ...who.where }, rule.holdHours, now),
        prisma.payout.count({ where: { ...who.where, source: 'WITHDRAWAL', status: { not: 'FAILED' }, createdAt: { gte: startOfLagosDay(now) } } }),
      ])
      const withdrawals = payoutSettings.withdrawals
      const cashOutReady = withdrawals.enabled && transfersEnabled() && Boolean(account?.paystackRecipientCode)
      return response.json({
        kind: who.kind,
        account: publicAccount(account),
        balances: { dueMinor: total('DUE'), payingMinor: total('PAYING'), paidMinor: total('PAID'), settledBySplitMinor: total('SETTLED_BY_SPLIT'), awaitingPriceCount: entries.filter((entry) => entry.status === 'NEEDS_REVIEW').length, availableMinor: Math.max(0, balance.availableMinor), heldMinor: Math.max(0, balance.heldMinor) },
        payout: {
          mode: transfersEnabled() ? rule.mode : 'MANUAL',
          frequency: rule.frequency, holdHours: rule.holdHours, minimumMinor: rule.minimumMinor,
          nextAt: transfersEnabled() && rule.mode === 'SCHEDULED' ? nextScheduledMoment(now, rule) : null,
          cashOut: { enabled: cashOutReady, feeMinor: withdrawals.feeMinor, feePercent: withdrawals.feePercent, minimumMinor: withdrawals.minimumMinor, remainingToday: Math.max(0, withdrawals.perDay - cashOutsToday), feeForAvailableMinor: balance.availableMinor > 0 ? withdrawalFee(balance.availableMinor, withdrawals) : 0 },
        },
        orders,
        rates: { doorstepRiderPercent: settings.commission.doorstepRiderPercent, ownRiderPercent: settings.commission.ownRiderPercent, riderFeePercent: settings.riderFee?.percent ?? 0, riderPay: settings.riderPay.enabled ? { bands: settings.riderPay.bands, perKmAfterMinor: settings.riderPay.perKmAfterMinor } : null },
        entries, payouts: payouts.map(({ receiptKey, ...payout }) => ({ ...payout, hasReceipt: Boolean(receiptKey) })),
      })
    } catch (error) { return fail(response, error) }
  })

  // Cash out now: the business or rider withdraws its cleared balance to its bank, less DOORSTEP's cash-out fee.
  router.post('/finance/withdraw', requireUser, withdrawLimiter, async (request, response) => {
    try {
      const who = await payee(request.user)
      const settings = await getPayoutSettings(prisma)
      const withdrawals = settings.withdrawals
      if (!withdrawals.enabled) return response.status(409).json({ error: 'CASH_OUT_OFF', message: 'Cash-outs are switched off. DOORSTEP pays you on its usual schedule.' })
      if (!transfersEnabled()) return response.status(409).json({ error: 'TRANSFERS_NOT_ENABLED', message: 'Cash-outs aren’t available right now. DOORSTEP pays you on its usual schedule.' })
      const account = await prisma.payoutAccount.findFirst({ where: who.where })
      if (!account?.paystackRecipientCode || account.status !== 'ACTIVE') return response.status(409).json({ error: 'NO_PAYOUT_ACCOUNT', message: 'Add your bank account first.' })
      const now = new Date()
      const today = await prisma.payout.count({ where: { ...who.where, source: 'WITHDRAWAL', status: { not: 'FAILED' }, createdAt: { gte: startOfLagosDay(now) } } })
      if (today >= withdrawals.perDay) return response.status(429).json({ error: 'CASH_OUT_LIMIT', message: `You can cash out ${withdrawals.perDay} time${withdrawals.perDay === 1 ? '' : 's'} a day. Try again tomorrow.` })
      const balance = await availableBalance(prisma, { party: who.kind, ...who.where }, ruleFor(settings, who.kind).holdHours, now)
      if (balance.availableMinor < withdrawals.minimumMinor) return response.status(409).json({ error: 'BELOW_CASH_OUT_MINIMUM', message: `You need at least ${naira(withdrawals.minimumMinor)} available to cash out. You have ${naira(Math.max(0, balance.availableMinor))}.` })
      const feeMinor = withdrawalFee(balance.availableMinor, withdrawals)
      const result = await createPayout(prisma, { party: who.kind, ...who.where, entryIds: balance.entryIds, method: 'PAYSTACK_TRANSFER', source: 'WITHDRAWAL', actorId: request.user.id, feeMinor, account, fetchImpl })
      return response.status(result.unconfirmed ? 202 : 201).json({ payout: { id: result.payout.id, amountMinor: result.payout.amountMinor, feeMinor, status: result.payout.status } })
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
        income: { commissionMinor: incomeBy.ORDER_COMMISSION || 0, serviceFeesMinor: incomeBy.SERVICE_FEE || 0, deliveryFeesMinor: incomeBy.DELIVERY_FEE || 0, parcelRevenueMinor: incomeBy.PARCEL_REVENUE || 0, cashOutFeesMinor: incomeBy.WITHDRAWAL_FEE || 0, riderFeesMinor: incomeBy.RIDER_SERVICE_FEE || 0 },
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
      const settings = await getFinanceSettings(prisma)
      const updated = await prisma.$transaction(async (transaction) => {
        const priced = await transaction.ledgerEntry.update({ where: { id: entry.id }, data: { amountMinor: body.amountMinor, status: 'DUE', description: `${entry.description.split(':')[0]} · set by DOORSTEP${body.note ? `: ${body.note}` : ''}` } })
        const fees = riderFeeEntries(riderFeeSource(priced), body.amountMinor, settings)
        if (fees.length) await transaction.ledgerEntry.createMany({ data: fees, skipDuplicates: true })
        return priced
      })
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
  // scope ALL pays everything owed (the admin's call); AVAILABLE pays only money that has cleared its hold.
  router.post('/admin/finance/payouts', requireUser, requireAdmin, async (request, response) => {
    try {
      const body = z.object({ restaurantId: z.string().min(1).optional(), riderId: z.string().min(1).optional(), method: z.enum(['PAYSTACK_TRANSFER', 'MANUAL']), manualReference: z.string().trim().min(3).max(80).optional(), scope: z.enum(['ALL', 'AVAILABLE']).default('ALL') })
        .refine((value) => Boolean(value.restaurantId) !== Boolean(value.riderId), 'Choose one business or rider.')
        .refine((value) => value.method !== 'MANUAL' || value.manualReference, 'Enter the bank transfer reference for a manual payout.').parse(request.body)
      const party = body.riderId ? 'RIDER' : 'RESTAURANT'
      const owner = body.riderId ? { riderId: body.riderId } : { restaurantId: body.restaurantId }
      const account = await prisma.payoutAccount.findFirst({ where: owner })
      const entryIds = body.scope === 'AVAILABLE' ? (await availableBalance(prisma, { party, ...owner }, ruleFor(await getPayoutSettings(prisma), party).holdHours)).entryIds : null
      const result = await createPayout(prisma, { party, ...owner, entryIds, method: body.method, source: 'ADMIN', actorId: request.user.id, manualReference: body.manualReference || null, account, fetchImpl })
      return response.status(result.unconfirmed ? 202 : 201).json(result)
    } catch (error) { return fail(response, error) }
  })

  // "Pay everyone now": sends every business and/or rider their cleared balance by Paystack Transfer.
  router.post('/admin/finance/payouts/run', requireUser, requireAdmin, async (request, response) => {
    try {
      const body = z.object({ party: z.enum(['RESTAURANT', 'RIDER', 'ALL']).default('ALL') }).parse(request.body || {})
      if (!transfersEnabled()) return response.status(409).json({ error: 'TRANSFERS_NOT_ENABLED', message: 'Paystack transfers are off, so payouts can only be recorded one by one as bank payments.' })
      const settings = await getPayoutSettings(prisma)
      const results = {}
      for (const party of body.party === 'ALL' ? ['RESTAURANT', 'RIDER'] : [body.party]) {
        results[party] = await payParty(prisma, party, { holdHours: ruleFor(settings, party).holdHours, minimumMinor: 100, source: 'BULK', actorId: request.user.id, respectBackoff: false, fetchImpl, limit: 100 })
      }
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'PAYOUTS_RUN', entityType: 'Payout', entityId: body.party, metadata: results } })
      return response.json({ results })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/finance/payout-settings', requireUser, requireAdmin, async (_request, response) => {
    try {
      const settings = await getPayoutSettings(prisma)
      const now = new Date()
      const next = Object.fromEntries(['RESTAURANT', 'RIDER'].map((party) => { const rule = ruleFor(settings, party); return [party, rule.mode === 'SCHEDULED' ? nextScheduledMoment(now, rule) : null] }))
      return response.json({ settings, transfersEnabled: transfersEnabled(), next })
    } catch (error) { return fail(response, error) }
  })

  router.put('/admin/finance/payout-settings', requireUser, requireAdmin, async (request, response) => {
    const parsed = payoutSettingsSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_PAYOUT_SETTINGS', message: parsed.error.issues[0]?.message })
    try {
      const previous = await getPayoutSettings(prisma)
      await prisma.platformSetting.upsert({ where: { key: PAYOUT_SETTINGS_KEY }, update: { value: parsed.data }, create: { key: PAYOUT_SETTINGS_KEY, value: parsed.data } })
      // A newly chosen timetable starts at its next time, rather than paying out the moment it is saved.
      const now = new Date()
      for (const party of ['RESTAURANT', 'RIDER']) {
        const before = ruleFor(previous, party)
        const after = ruleFor(parsed.data, party)
        const timetableChanged = before.mode !== after.mode || before.frequency !== after.frequency || before.weekday !== after.weekday || before.hour !== after.hour
        if (after.mode === 'SCHEDULED' && timetableChanged) await markScheduleRun(prisma, party, lastScheduledMoment(now, after).toISOString())
      }
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'PAYOUT_SETTINGS_UPDATED', entityType: 'PlatformSetting', entityId: PAYOUT_SETTINGS_KEY, metadata: { previous, next: parsed.data } } })
      return response.json({ settings: parsed.data, transfersEnabled: transfersEnabled() })
    } catch (error) { return fail(response, error) }
  })

  // Manual credit (positive) or debit (negative) on a business's or rider's balance, e.g. a refund they covered.
  router.post('/admin/finance/adjustments', requireUser, requireAdmin, async (request, response) => {
    try {
      const body = z.object({ restaurantId: z.string().min(1).optional(), riderId: z.string().min(1).optional(), amountMinor: z.number().int().min(-10_000_000).max(10_000_000).refine((value) => value !== 0, 'Enter an amount.'), note: z.string().trim().min(3, 'Say what the adjustment is for.').max(200) })
        .refine((value) => Boolean(value.restaurantId) !== Boolean(value.riderId), 'Choose one business or rider.').parse(request.body)
      const party = body.riderId ? 'RIDER' : 'RESTAURANT'
      const owner = body.riderId ? { riderId: body.riderId } : { restaurantId: body.restaurantId }
      const exists = body.riderId ? await prisma.rider.findUnique({ where: { id: body.riderId }, select: { userId: true } }) : await prisma.restaurant.findUnique({ where: { id: body.restaurantId }, select: { id: true } })
      if (!exists) return response.status(404).json({ error: 'PAYEE_NOT_FOUND', message: 'That business or rider was not found.' })
      const entry = await prisma.ledgerEntry.create({ data: { party, ...owner, type: 'ADJUSTMENT', amountMinor: body.amountMinor, status: 'DUE', description: body.note, dedupeKey: `MANUAL_ADJUSTMENT:${randomUUID()}` } })
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'BALANCE_ADJUSTED', entityType: 'LedgerEntry', entityId: entry.id, metadata: { party, ...owner, amountMinor: body.amountMinor, note: body.note } } })
      const userIds = body.riderId ? [exists.userId] : await restaurantTeamIds(prisma, body.restaurantId)
      await notifyUsers(prisma, userIds, { type: 'PAYMENT', title: body.amountMinor > 0 ? `${naira(body.amountMinor)} added to your balance` : `${naira(-body.amountMinor)} deducted from your balance`, body: body.note, link: body.riderId ? '/rider/earnings' : '/restaurant/earnings' })
      return response.status(201).json({ entry })
    } catch (error) { return fail(response, error) }
  })

  // Businesses and riders, for adjustments and per-business commission rates.
  router.get('/admin/finance/payees', requireUser, requireAdmin, async (_request, response) => {
    try {
      const [restaurants, riders] = await Promise.all([
        prisma.restaurant.findMany({ where: { status: 'APPROVED' }, orderBy: { name: 'asc' }, take: 500, select: { id: true, name: true, commissionDoorstepRiderPercent: true, commissionOwnRiderPercent: true } }),
        prisma.rider.findMany({ where: { status: 'APPROVED' }, take: 500, select: { id: true, network: true, user: { select: { firstName: true, lastName: true } } } }),
      ])
      return response.json({
        restaurants: restaurants.map((entry) => ({ id: entry.id, name: entry.name, doorstepRiderPercent: entry.commissionDoorstepRiderPercent == null ? null : Number(entry.commissionDoorstepRiderPercent), ownRiderPercent: entry.commissionOwnRiderPercent == null ? null : Number(entry.commissionOwnRiderPercent) })),
        riders: riders.filter((entry) => entry.network !== 'BUSINESS_OWNED').map((entry) => ({ id: entry.id, name: `${entry.user.firstName || ''} ${entry.user.lastName || ''}`.trim() || 'Rider' })).sort((a, b) => a.name.localeCompare(b.name)),
      })
    } catch (error) { return fail(response, error) }
  })

  // Negotiated commission for one business (null = platform rate). Applies to new orders only.
  router.put('/admin/finance/restaurants/:restaurantId/commission', requireUser, requireAdmin, async (request, response) => {
    try {
      const percent = z.number().min(0).max(50).nullable()
      const body = z.object({ doorstepRiderPercent: percent, ownRiderPercent: percent }).parse(request.body)
      const restaurant = await prisma.restaurant.update({ where: { id: request.params.restaurantId }, data: { commissionDoorstepRiderPercent: body.doorstepRiderPercent, commissionOwnRiderPercent: body.ownRiderPercent }, select: { id: true, name: true } })
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'BUSINESS_COMMISSION_SET', entityType: 'Restaurant', entityId: restaurant.id, metadata: body } })
      const describe = (value) => value == null ? 'the standard rate' : `${value}%`
      await notifyUsers(prisma, await restaurantTeamIds(prisma, restaurant.id), { type: 'PAYMENT', title: 'Your DOORSTEP commission was updated', body: body.doorstepRiderPercent == null && body.ownRiderPercent == null ? 'You are back on the standard commission rates.' : `New orders use ${describe(body.doorstepRiderPercent)} with DOORSTEP riders and ${describe(body.ownRiderPercent)} with your own riders.`, link: '/restaurant/earnings' })
      return response.json({ restaurant: { ...restaurant, ...body } })
    } catch (error) {
      if (error?.code === 'P2025') return response.status(404).json({ error: 'RESTAURANT_NOT_FOUND' })
      return fail(response, error)
    }
  })

  // One partner, in full, for paying them by hand: contact details, bank account (full number from Paystack),
  // and every owed line with its order, sales and commission percentage. Each view is audited.
  router.get('/admin/finance/payees/:kind/:id', requireUser, requireAdmin, async (request, response) => {
    try {
      const kind = request.params.kind === 'rider' ? 'RIDER' : request.params.kind === 'business' ? 'RESTAURANT' : null
      if (!kind) return response.status(404).json({ error: 'PAYEE_NOT_FOUND' })
      const owner = kind === 'RIDER' ? { riderId: request.params.id } : { restaurantId: request.params.id }
      const profile = kind === 'RIDER'
        ? await prisma.rider.findUnique({ where: { id: request.params.id }, select: { id: true, status: true, vehicleType: true, network: true, user: { select: { firstName: true, lastName: true, phone: true, email: true } } } }).then((rider) => rider && { kind, id: rider.id, name: `${rider.user.firstName || ''} ${rider.user.lastName || ''}`.trim() || 'Rider', phone: rider.user.phone, email: rider.user.email, detail: [rider.vehicleType, rider.network === 'BUSINESS_OWNED' ? 'Business rider' : 'DOORSTEP rider'].filter(Boolean).join(' · '), status: rider.status })
        : await prisma.restaurant.findUnique({ where: { id: request.params.id }, select: { id: true, name: true, phone: true, email: true, address: true, status: true, application: { select: { ownerName: true, ownerPhone: true, ownerEmail: true, whatsApp: true } } } }).then((business) => business && { kind, id: business.id, name: business.name, phone: business.application?.ownerPhone || business.phone, email: business.application?.ownerEmail || business.email, whatsApp: business.application?.whatsApp || null, owner: business.application?.ownerName || null, detail: business.address, status: business.status })
      if (!profile) return response.status(404).json({ error: 'PAYEE_NOT_FOUND', message: 'That business or rider was not found.' })
      const [account, settings, due, payouts] = await Promise.all([
        prisma.payoutAccount.findFirst({ where: owner }),
        getPayoutSettings(prisma),
        prisma.ledgerEntry.findMany({ where: { party: kind, ...owner, status: 'DUE' }, orderBy: { createdAt: 'asc' }, take: 300, select: { id: true, type: true, amountMinor: true, description: true, orderId: true, createdAt: true } }),
        prisma.payout.findMany({ where: owner, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, amountMinor: true, method: true, source: true, status: true, transferCode: true, createdAt: true, confirmedAt: true, disputeNote: true, receiptKey: true } }),
      ])
      let bank = null
      if (account) {
        bank = { bankName: account.bankName, accountName: account.accountName, accountNumber: null, last4: account.accountLast4, verifiedAt: account.verifiedAt, status: account.status }
        if (account.paystackRecipientCode) {
          try { bank.accountNumber = (await fetchRecipient(account.paystackRecipientCode, { fetchImpl })).accountNumber } catch (error) { bank.lookupError = error?.message || 'Paystack could not be reached for the full number.' }
        }
        await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'PAYOUT_ACCOUNT_VIEWED', entityType: 'PayoutAccount', entityId: account.id, metadata: { fullNumberShown: Boolean(bank.accountNumber) } } })
      }
      const orderIds = [...new Set(due.map((entry) => entry.orderId).filter(Boolean))]
      const orders = orderIds.length ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true, status: true, subtotalMinor: true, deliveryFeeMinor: true, commissionPercent: true, fulfilment: true, createdAt: true } }) : []
      const orderOf = new Map(orders.map((order) => [order.id, order]))
      const balance = await availableBalance(prisma, { party: kind, ...owner }, ruleFor(settings, kind).holdHours)
      return response.json({
        profile, bank, balance,
        lines: due.map((entry) => {
          const order = entry.orderId ? orderOf.get(entry.orderId) : null
          return { ...entry, order: order ? { orderNumber: order.orderNumber, status: order.status, salesMinor: order.subtotalMinor, commissionPercent: order.commissionPercent == null ? null : Number(order.commissionPercent), commissionMinor: order.commissionPercent == null ? null : Math.round(order.subtotalMinor * Number(order.commissionPercent) / 100), deliveryFeeKeptMinor: order.fulfilment === 'BUSINESS_RIDER' ? order.deliveryFeeMinor : 0 } : null, cleared: balance.entryIds.includes(entry.id) }
        }),
        payouts: payouts.map(({ receiptKey, ...payout }) => ({ ...payout, hasReceipt: Boolean(receiptKey) })),
      })
    } catch (error) { return fail(response, error) }
  })

  // Receipt (screenshot or PDF) of a bank payment the admin made, shown to the partner when they confirm.
  router.post('/admin/finance/payouts/:payoutId/receipt', requireUser, requireAdmin, (request, response, next) => receiptUpload(request, response, (error) => {
    if (error) return response.status(400).json({ error: 'RECEIPT_UPLOAD_FAILED', message: error.code === 'LIMIT_FILE_SIZE' ? 'The receipt must be 5 MB or smaller.' : 'Could not read that file. Use a JPG, PNG or PDF.' })
    return next()
  }), async (request, response) => {
    try {
      if (!request.file) return response.status(400).json({ error: 'RECEIPT_REQUIRED', message: 'Choose a screenshot or PDF of the transfer.' })
      const payout = await prisma.payout.findUnique({ where: { id: request.params.payoutId } })
      if (!payout || payout.method !== 'MANUAL') return response.status(404).json({ error: 'PAYOUT_NOT_FOUND' })
      const stored = await storePrivateDocument({ buffer: request.file.buffer, mimeType: request.file.mimetype, originalName: request.file.originalname, keyPrefix: `private/payout-receipts/${payout.id}/` })
      await prisma.payout.update({ where: { id: payout.id }, data: { receiptKey: stored.storageKey } })
      return response.status(201).json({ hasReceipt: true })
    } catch (error) {
      if (error?.code === 'UNSUPPORTED_DOCUMENT_TYPE') return response.status(400).json({ error: error.code, message: 'Upload a JPG or PNG screenshot, or a PDF.' })
      return fail(response, error)
    }
  })

  async function sendPayoutReceipt(response, payout) {
    if (!payout?.receiptKey) return response.status(404).json({ error: 'RECEIPT_NOT_FOUND' })
    const file = await readPrivateDocument(payout.receiptKey)
    response.set('Content-Type', file.mimeType)
    response.set('Cache-Control', 'private, no-store')
    response.set('Content-Disposition', `inline; filename="doorstep-payout${file.mimeType === 'application/pdf' ? '.pdf' : file.mimeType === 'image/png' ? '.png' : '.jpg'}"`)
    return response.send(file.buffer)
  }
  router.get('/admin/finance/payouts/:payoutId/receipt', requireUser, requireAdmin, async (request, response) => {
    try { return await sendPayoutReceipt(response, await prisma.payout.findUnique({ where: { id: request.params.payoutId } })) } catch (error) { return fail(response, error) }
  })
  router.get('/finance/payouts/:payoutId/receipt', requireUser, async (request, response) => {
    try {
      const who = await payee(request.user)
      return await sendPayoutReceipt(response, await prisma.payout.findFirst({ where: { id: request.params.payoutId, ...who.where } }))
    } catch (error) { return fail(response, error) }
  })

  // The partner answers: "I received it" (the payout is complete) or "I haven't received it" (admins are alerted).
  router.post('/finance/payouts/:payoutId/confirm', requireUser, async (request, response) => {
    try {
      const who = await payee(request.user)
      const body = z.object({ received: z.boolean(), note: z.string().trim().max(500).optional() }).parse(request.body)
      const payout = await prisma.payout.findFirst({ where: { id: request.params.payoutId, ...who.where } })
      if (!payout) return response.status(404).json({ error: 'PAYOUT_NOT_FOUND' })
      if (body.received) {
        const confirmed = await confirmPayout(prisma, payout.id, { userId: request.user.id })
        if (!confirmed) return response.status(409).json({ error: 'PAYOUT_NOT_WAITING', message: 'This payout has already been settled.' })
        return response.json({ payout: { id: confirmed.id, status: confirmed.status } })
      }
      if (!body.note || body.note.length < 3) return response.status(400).json({ error: 'NOTE_REQUIRED', message: 'Tell DOORSTEP what you checked (e.g. "nothing in my GTBank account since Monday").' })
      const disputed = await disputePayout(prisma, payout.id, { userId: request.user.id, note: body.note })
      if (!disputed) return response.status(409).json({ error: 'PAYOUT_NOT_WAITING', message: 'This payout can no longer be disputed here. Contact DOORSTEP support.' })
      return response.json({ payout: { id: disputed.id, status: disputed.status } })
    } catch (error) { return fail(response, error) }
  })

  // Admin decision on a manual payout still waiting for the partner, or disputed by them.
  router.post('/admin/finance/payouts/:payoutId/resolve', requireUser, requireAdmin, async (request, response) => {
    try {
      const body = z.object({ action: z.enum(['MARK_PAID', 'CANCEL']), note: z.string().trim().min(3, 'Add a short note.').max(300) }).parse(request.body)
      const payout = await resolvePayout(prisma, request.params.payoutId, { action: body.action, userId: request.user.id, note: body.note })
      if (!payout) return response.status(409).json({ error: 'PAYOUT_NOT_WAITING', message: 'This payout is already settled. Refresh.' })
      return response.json({ payout })
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

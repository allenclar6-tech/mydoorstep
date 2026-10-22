import { randomUUID } from 'node:crypto'
import { naira } from './financeService.js'
import { notifyAdmins, notifyUsers, restaurantTeamIds } from './notify.js'
import { sendTransfer, transferCertainlyNotSent } from './paystackPayouts.js'
import { applyTransferResult, availableBalance, transfersEnabled } from './payoutEngine.js'
import { getPayoutSettings, ruleFor, startOfLagosDay, withdrawalFee } from './payoutSettings.js'

// Withdrawals that always work. A business or rider taps "Withdraw" on Earnings:
//   • Paystack Transfers on  → the existing instant cash-out (/finance/withdraw) sends it straight to their bank.
//   • Transfers not set up   → a withdrawal REQUEST: the exact cleared ledger lines are reserved at once (so the
//     same money can't be withdrawn twice), admins are alerted, and an admin either sends it by Paystack with one
//     tap, or pays it from the bank app and records the reference — then the partner confirms it arrived.
// Requests are Payout rows with status REQUESTED (method MANUAL, source WITHDRAWAL); no schema change needed.

export const REQUESTED = 'REQUESTED'
export const earningsLink = (party) => party === 'RIDER' ? '/rider/earnings' : '/restaurant/earnings'

export async function payeeOf(prisma, user) {
  if (user.role === 'RIDER' && user.rider) return { kind: 'RIDER', owner: { riderId: user.rider.id }, name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Rider' }
  if (user.role === 'RESTAURANT') {
    const membership = await prisma.restaurantUser.findFirst({ where: { userId: user.id }, include: { restaurant: { select: { id: true, name: true } } } })
    if (membership) return { kind: 'RESTAURANT', owner: { restaurantId: membership.restaurant.id }, name: membership.restaurant.name }
  }
  throw Object.assign(new Error('Only businesses and riders can withdraw.'), { code: 'PAYEE_ROLE_REQUIRED', status: 403 })
}
export async function payeeUserIds(db, payout) {
  if (payout.party === 'RIDER') return [(await db.rider.findUnique({ where: { id: payout.riderId }, select: { userId: true } }))?.userId].filter(Boolean)
  return restaurantTeamIds(db, payout.restaurantId)
}

/** What the partner can do right now: instant cash-out, a request, or nothing — and why. */
export async function withdrawalOptions(prisma, { kind, owner }, now = new Date()) {
  const [settings, account, open, today] = await Promise.all([
    getPayoutSettings(prisma),
    prisma.payoutAccount.findFirst({ where: owner }),
    prisma.payout.findFirst({ where: { ...owner, source: 'WITHDRAWAL', status: { in: [REQUESTED, 'PENDING', 'PROCESSING'] } }, orderBy: { createdAt: 'desc' } }),
    prisma.payout.count({ where: { ...owner, source: 'WITHDRAWAL', status: { not: 'FAILED' }, createdAt: { gte: startOfLagosDay(now) } } }),
  ])
  const w = settings.withdrawals
  const balance = await availableBalance(prisma, { party: kind, ...owner }, ruleFor(settings, kind).holdHours, now)
  const available = Math.max(0, balance.availableMinor)
  const feeMinor = available > 0 ? withdrawalFee(available, w) : 0
  const accountReady = Boolean(account && account.status === 'ACTIVE' && account.paystackRecipientCode)
  const instant = w.enabled && transfersEnabled() && accountReady
  // Partners can always ASK for a withdrawal. The admin's "Cash out now" switch only decides whether it is
  // sent instantly by Paystack (when Transfers are on) instead of being approved by DOORSTEP.
  let blocked = null
  if (!accountReady) blocked = 'NO_ACCOUNT'
  else if (open) blocked = 'OPEN_REQUEST'
  else if (today >= w.perDay) blocked = 'DAILY_LIMIT'
  else if (available < w.minimumMinor) blocked = 'BELOW_MINIMUM'
  else if (available - feeMinor < 100) blocked = 'FEE_TOO_HIGH'
  return {
    mode: instant ? 'INSTANT' : 'REQUEST',
    blocked,
    availableMinor: available,
    heldMinor: Math.max(0, balance.heldMinor),
    feeMinor,
    netMinor: Math.max(0, available - feeMinor),
    minimumMinor: w.minimumMinor,
    remainingToday: Math.max(0, w.perDay - today),
    fee: { flatMinor: w.feeMinor, percent: w.feePercent },
    account: account ? { bankName: account.bankName, accountName: account.accountName, last4: account.accountLast4 } : null,
    openRequest: open ? { id: open.id, amountMinor: open.amountMinor, feeMinor: open.feeMinor, status: open.status, createdAt: open.createdAt } : null,
    entryIds: balance.entryIds,
  }
}

/** Reserves every cleared line for this partner and records the request. Throws a coded error when not allowed. */
export async function createWithdrawalRequest(prisma, who, { actorId, now = new Date() } = {}) {
  const options = await withdrawalOptions(prisma, who, now)
  const messages = {
    NO_ACCOUNT: 'Add your bank account first (Earnings → Add bank account).',
    OPEN_REQUEST: 'You already have a withdrawal on its way. You can request another once it’s done.',
    DAILY_LIMIT: 'You’ve reached today’s withdrawal limit. Try again tomorrow.',
    BELOW_MINIMUM: `You need at least ${naira(options.minimumMinor)} ready to withdraw. You have ${naira(options.availableMinor)}.`,
    FEE_TOO_HIGH: 'Your balance is too small to cover the withdrawal fee.',
  }
  if (options.blocked) throw Object.assign(new Error(messages[options.blocked]), { code: options.blocked, status: 409 })
  const account = await prisma.payoutAccount.findFirst({ where: who.owner })
  const reference = `dsp_wd_${randomUUID().replaceAll('-', '').slice(0, 24)}`
  const payout = await prisma.$transaction(async (transaction) => {
    const due = await transaction.ledgerEntry.findMany({ where: { ...who.owner, party: who.kind, status: 'DUE', id: { in: options.entryIds } }, select: { id: true, amountMinor: true } })
    const gross = due.reduce((sum, entry) => sum + entry.amountMinor, 0)
    const feeMinor = withdrawalFee(gross, (await getPayoutSettings(transaction)).withdrawals)
    const amountMinor = gross - feeMinor
    if (amountMinor < 100) throw Object.assign(new Error('Nothing is ready to withdraw right now.'), { code: 'NOTHING_TO_WITHDRAW', status: 409 })
    const created = await transaction.payout.create({ data: { party: who.kind, ...who.owner, amountMinor, feeMinor, method: 'MANUAL', source: 'WITHDRAWAL', status: REQUESTED, reference, bankSnapshot: { bankName: account.bankName, accountName: account.accountName, last4: account.accountLast4 }, createdById: actorId } })
    const reserved = await transaction.ledgerEntry.updateMany({ where: { id: { in: due.map((entry) => entry.id) }, status: 'DUE' }, data: { status: 'PAYING', payoutId: created.id } })
    if (reserved.count !== due.length) throw Object.assign(new Error('Your balance just changed. Try again.'), { code: 'BALANCE_CHANGED', status: 409 })
    if (feeMinor > 0) await transaction.ledgerEntry.createMany({ data: [
      { party: who.kind, ...who.owner, type: 'WITHDRAWAL_FEE', amountMinor: -feeMinor, status: 'PAYING', payoutId: created.id, description: `Withdrawal fee (${naira(feeMinor)})`, dedupeKey: `WITHDRAWAL_FEE:${created.id}` },
      { party: 'PLATFORM', type: 'WITHDRAWAL_FEE', amountMinor: feeMinor, status: 'PAYING', payoutId: created.id, description: `Withdrawal fee on ${reference.slice(-8)}`, dedupeKey: `WITHDRAWAL_FEE_INCOME:${created.id}` },
    ] })
    await transaction.auditLog.create({ data: { actorId, action: 'WITHDRAWAL_REQUESTED', entityType: 'Payout', entityId: created.id, metadata: { party: who.kind, ...who.owner, amountMinor, feeMinor, lines: due.length } } })
    return created
  })
  await notifyAdmins(prisma, { type: 'PAYMENT', title: `Withdrawal request: ${naira(payout.amountMinor)}`, body: `${who.name} wants ${naira(payout.amountMinor)} sent to ${account.bankName} ••••${account.accountLast4}. Approve it in Admin → Money.`, link: '/admin/finance' })
  return payout
}

/** Puts a request's lines back in the balance (partner cancelled, or DOORSTEP declined). */
export async function releaseRequest(prisma, payoutId, { reason, actorId, action }) {
  return prisma.$transaction(async (transaction) => {
    const changed = await transaction.payout.updateMany({ where: { id: payoutId, status: REQUESTED }, data: { status: 'FAILED', completedAt: new Date(), failureReason: reason } })
    if (changed.count !== 1) return null
    await transaction.ledgerEntry.updateMany({ where: { payoutId, type: 'WITHDRAWAL_FEE', status: 'PAYING' }, data: { status: 'VOID' } })
    await transaction.ledgerEntry.updateMany({ where: { payoutId, status: 'PAYING' }, data: { status: 'DUE', payoutId: null } })
    await transaction.auditLog.create({ data: { actorId, action, entityType: 'Payout', entityId: payoutId, metadata: { reason } } })
    return transaction.payout.findUnique({ where: { id: payoutId } })
  })
}

/** Admin sends a request by Paystack Transfer straight to the partner's bank. */
export async function sendRequestByPaystack(prisma, payoutId, { actorId, fetchImpl } = {}) {
  if (!transfersEnabled()) throw Object.assign(new Error('Paystack Transfers are not switched on yet. Pay it from your bank app and record the reference instead.'), { code: 'TRANSFERS_NOT_ENABLED', status: 409 })
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } })
  if (!payout || payout.status !== REQUESTED) throw Object.assign(new Error('This request was already handled. Refresh.'), { code: 'NOT_REQUESTED', status: 409 })
  const account = await prisma.payoutAccount.findFirst({ where: payout.riderId ? { riderId: payout.riderId } : { restaurantId: payout.restaurantId } })
  if (!account?.paystackRecipientCode) throw Object.assign(new Error('This partner has no verified bank account.'), { code: 'NO_PAYOUT_ACCOUNT', status: 409 })
  const claimed = await prisma.payout.updateMany({ where: { id: payoutId, status: REQUESTED }, data: { status: 'PENDING', method: 'PAYSTACK_TRANSFER' } })
  if (claimed.count !== 1) throw Object.assign(new Error('This request was already handled. Refresh.'), { code: 'NOT_REQUESTED', status: 409 })
  await prisma.auditLog.create({ data: { actorId, action: 'WITHDRAWAL_SENT_BY_PAYSTACK', entityType: 'Payout', entityId: payoutId, metadata: { amountMinor: payout.amountMinor } } })
  try {
    const sent = await sendTransfer({ amountMinor: payout.amountMinor, recipientCode: account.paystackRecipientCode, reference: payout.reference, reason: `DOORSTEP withdrawal ${payout.reference.slice(-8)}` }, { fetchImpl })
    if (sent.status === 'success') return applyTransferResult(prisma, payout.reference, 'success')
    return prisma.payout.update({ where: { id: payoutId }, data: { status: 'PROCESSING', transferCode: sent.transferCode, failureReason: sent.status === 'otp' ? 'OTP_REQUIRED: finish it in the Paystack dashboard, or turn off transfer OTP in Paystack → Settings → Preferences' : null } })
  } catch (error) {
    if (transferCertainlyNotSent(error)) { await applyTransferResult(prisma, payout.reference, 'failed', error.message); throw error }
    return prisma.payout.update({ where: { id: payoutId }, data: { status: 'PROCESSING', failureReason: 'UNCONFIRMED: Paystack did not confirm this transfer. Use Check status before paying again.' } })
  }
}

/** Admin paid it from the bank app: the request becomes a bank payment the partner confirms. */
export async function markRequestPaid(prisma, payoutId, { bankReference, note, actorId }) {
  const changed = await prisma.payout.updateMany({ where: { id: payoutId, status: REQUESTED }, data: { status: 'AWAITING_CONFIRMATION', transferCode: bankReference } })
  if (changed.count !== 1) return null
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } })
  await prisma.auditLog.create({ data: { actorId, action: 'WITHDRAWAL_PAID_MANUALLY', entityType: 'Payout', entityId: payoutId, metadata: { bankReference, note: note || null } } })
  await notifyUsers(prisma, await payeeUserIds(prisma, payout), { type: 'PAYMENT', title: `Your withdrawal of ${naira(payout.amountMinor)} was sent`, body: `DOORSTEP sent it to ${payout.bankSnapshot?.bankName || 'your bank'} ••••${payout.bankSnapshot?.last4 || ''} (ref ${bankReference}). Open Earnings and tap “I received it” once it shows.`, link: earningsLink(payout.party) })
  return payout
}


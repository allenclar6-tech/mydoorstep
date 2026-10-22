import { randomUUID } from 'node:crypto'
import { naira } from './financeService.js'
import { notifyAdmins, notifyUsers, restaurantTeamIds } from './notify.js'
import { sendTransfer, transferCertainlyNotSent } from './paystackPayouts.js'
import { getPayoutSettings, lastScheduledMoment, PAYOUT_SCHEDULE_STATE_KEY, ruleFor } from './payoutSettings.js'

// Moves money from DOORSTEP's Paystack balance to businesses and riders. Every payout path (an admin, "Pay
// everyone", automatic, scheduled, or a payee's own cash-out) goes through createPayout, which reserves the owed
// ledger entries in one transaction, so the same naira can never be paid twice.

export const transfersEnabled = () => process.env.PAYSTACK_TRANSFERS_ENABLED === 'true' && Boolean(process.env.PAYSTACK_SECRET_KEY)
// After an automatic transfer fails, that payee is left alone for a while instead of retrying every minute.
export const AUTO_RETRY_AFTER_MS = 6 * 60 * 60_000
const AUTO_SOURCES = ['AUTOMATIC', 'SCHEDULED']
const earningsLink = (party) => party === 'RIDER' ? '/rider/earnings' : '/restaurant/earnings'

export const ownerOf = ({ restaurantId, riderId }) => riderId ? { riderId } : { restaurantId }
async function payeeUserIds(db, { party, restaurantId, riderId }) {
  if (party === 'RIDER') return [(await db.rider.findUnique({ where: { id: riderId }, select: { userId: true } }))?.userId].filter(Boolean)
  return restaurantTeamIds(db, restaurantId)
}

/** Applies a Paystack transfer result (webhook or verify) to a payout and its ledger entries. Idempotent. */
export async function applyTransferResult(prisma, reference, status, reason = null) {
  const payout = await prisma.payout.findUnique({ where: { reference } })
  if (!payout || payout.status === 'PAID' || payout.status === 'FAILED') return payout
  if (status === 'success') {
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.payout.updateMany({ where: { id: payout.id, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'PAID', completedAt: new Date(), failureReason: null } })
      if (changed.count !== 1) return
      // DOORSTEP's cash-out fee becomes income; everything else in the payout is now paid.
      await transaction.ledgerEntry.updateMany({ where: { payoutId: payout.id, party: 'PLATFORM', status: 'PAYING' }, data: { status: 'RETAINED' } })
      await transaction.ledgerEntry.updateMany({ where: { payoutId: payout.id, status: 'PAYING' }, data: { status: 'PAID' } })
      await notifyUsers(transaction, await payeeUserIds(transaction, payout), { type: 'PAYMENT', title: `Payout of ${naira(payout.amountMinor)} sent`, body: 'DOORSTEP sent your earnings to your bank. Banks usually credit within minutes.', link: earningsLink(payout.party) })
    })
  } else if (['failed', 'reversed', 'abandoned', 'blocked', 'rejected'].includes(status)) {
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.payout.updateMany({ where: { id: payout.id, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED', completedAt: new Date(), failureReason: reason || status } })
      if (changed.count !== 1) return
      // The money was not sent, so no cash-out fee is charged and the earnings are owed again.
      await transaction.ledgerEntry.updateMany({ where: { payoutId: payout.id, type: 'WITHDRAWAL_FEE', status: 'PAYING' }, data: { status: 'VOID' } })
      await transaction.ledgerEntry.updateMany({ where: { payoutId: payout.id, status: 'PAYING' }, data: { status: 'DUE', payoutId: null } })
      await notifyAdmins(transaction, { type: 'PAYMENT', title: 'Payout failed', body: `${naira(payout.amountMinor)} transfer ${payout.reference} ${status}${reason ? `: ${reason}` : ''}. The amount is owed again.`, link: '/admin/finance' })
      if (payout.source === 'WITHDRAWAL') await notifyUsers(transaction, await payeeUserIds(transaction, payout), { type: 'PAYMENT', title: 'Cash-out didn’t go through', body: `Your ${naira(payout.amountMinor)} cash-out failed, so no fee was charged and the money is back in your balance.`, link: earningsLink(payout.party) })
    })
  }
  return prisma.payout.findUnique({ where: { reference } })
}

/**
 * Has this owed entry cleared? Deductions apply straight away, except DOORSTEP's rider fee, which clears with its earning. Order money clears once the order is
 * delivered and the hold has passed; package earnings after the hold; admin credits immediately.
 */
export function entryAvailable(entry, orderStatus, holdHours, now = new Date()) {
  if (entry.amountMinor < 0 && entry.type !== 'RIDER_SERVICE_FEE') return true
  if (!entry.orderId && !entry.parcelBookingId) return true
  if (now.getTime() - new Date(entry.createdAt).getTime() < holdHours * 3_600_000) return false
  if (entry.orderId) return orderStatus === 'DELIVERED'
  return true
}

/** What one business or rider could be paid right now, and what is still on hold. */
export async function availableBalance(db, { party, restaurantId, riderId }, holdHours, now = new Date()) {
  const due = await db.ledgerEntry.findMany({ where: { party, ...ownerOf({ restaurantId, riderId }), status: 'DUE' }, select: { id: true, type: true, amountMinor: true, orderId: true, parcelBookingId: true, createdAt: true } })
  const orderIds = [...new Set(due.map((entry) => entry.orderId).filter(Boolean))]
  const orders = orderIds.length ? await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, status: true } }) : []
  const statusOf = new Map(orders.map((order) => [order.id, order.status]))
  let availableMinor = 0
  let heldMinor = 0
  const entryIds = []
  for (const entry of due) {
    if (entryAvailable(entry, statusOf.get(entry.orderId), holdHours, now)) { availableMinor += entry.amountMinor; entryIds.push(entry.id) } else heldMinor += entry.amountMinor
  }
  return { availableMinor, heldMinor, dueMinor: availableMinor + heldMinor, entryIds }
}

/**
 * Pays owed entries to one business or rider. `entryIds` limits it to cleared money (null = everything owed).
 * MANUAL records a bank payment the admin already made; PAYSTACK_TRANSFER sends it from the Paystack balance.
 * Returns { payout, unconfirmed }.
 */
export async function createPayout(db, { party, restaurantId, riderId, entryIds = null, method, source = 'ADMIN', actorId = null, manualReference = null, feeMinor = 0, account, fetchImpl }) {
  const owner = ownerOf({ restaurantId, riderId })
  if (method === 'PAYSTACK_TRANSFER') {
    if (!transfersEnabled()) throw Object.assign(new Error('Paystack transfers are off. Turn on Transfers in Paystack and set PAYSTACK_TRANSFERS_ENABLED=true on the API, or record a manual payout.'), { code: 'TRANSFERS_NOT_ENABLED', status: 409 })
    if (!account?.paystackRecipientCode) throw Object.assign(new Error('This payee has not added a verified bank account yet.'), { code: 'NO_PAYOUT_ACCOUNT', status: 409 })
  }
  const manual = method === 'MANUAL'
  const reference = `dsp_payout_${randomUUID().replaceAll('-', '').slice(0, 24)}`
  // Reserve the owed entries atomically so two admins (or an admin and the scheduler) can't pay the same money twice.
  const payout = await db.$transaction(async (transaction) => {
    const due = await transaction.ledgerEntry.findMany({ where: { ...owner, party, status: 'DUE', ...(entryIds ? { id: { in: entryIds } } : {}) }, select: { id: true, amountMinor: true } })
    const grossMinor = due.reduce((sum, entry) => sum + entry.amountMinor, 0)
    const amountMinor = grossMinor - feeMinor
    if (amountMinor < 100) throw Object.assign(new Error(grossMinor < 0 ? 'This payee owes DOORSTEP money; nothing to pay out.' : feeMinor && grossMinor > 0 ? 'The balance is too small to cover the cash-out fee.' : 'Nothing is owed right now.'), { code: 'NOTHING_TO_PAY', status: 409 })
    const created = await transaction.payout.create({ data: { party, ...owner, amountMinor, feeMinor, method, source, status: manual ? 'PAID' : 'PENDING', reference, transferCode: manualReference, bankSnapshot: account ? { bankName: account.bankName, accountName: account.accountName, last4: account.accountLast4 } : null, createdById: actorId, completedAt: manual ? new Date() : null } })
    const reserved = await transaction.ledgerEntry.updateMany({ where: { id: { in: due.map((entry) => entry.id) }, status: 'DUE' }, data: { status: manual ? 'PAID' : 'PAYING', payoutId: created.id } })
    if (reserved.count !== due.length) throw Object.assign(new Error('Balances changed while preparing the payout. Try again.'), { code: 'BALANCE_CHANGED', status: 409 })
    if (feeMinor > 0) {
      await transaction.ledgerEntry.createMany({ data: [
        { party, ...owner, type: 'WITHDRAWAL_FEE', amountMinor: -feeMinor, status: manual ? 'PAID' : 'PAYING', payoutId: created.id, description: `Cash-out fee (${naira(feeMinor)})`, dedupeKey: `WITHDRAWAL_FEE:${created.id}` },
        { party: 'PLATFORM', type: 'WITHDRAWAL_FEE', amountMinor: feeMinor, status: manual ? 'RETAINED' : 'PAYING', payoutId: created.id, description: `Cash-out fee on payout ${reference.slice(-8)}`, dedupeKey: `WITHDRAWAL_FEE_INCOME:${created.id}` },
      ] })
    }
    await transaction.auditLog.create({ data: { actorId, action: `PAYOUT_${method}`, entityType: 'Payout', entityId: created.id, metadata: { source, amountMinor, feeMinor, entries: due.length, manualReference } } })
    return created
  })
  if (manual) {
    await notifyUsers(db, await payeeUserIds(db, { party, ...owner }), { type: 'PAYMENT', title: `Payout of ${naira(payout.amountMinor)} sent`, body: `DOORSTEP paid you by bank transfer (ref ${manualReference}).`, link: earningsLink(party) })
    return { payout, unconfirmed: false }
  }
  try {
    const sent = await sendTransfer({ amountMinor: payout.amountMinor, recipientCode: account.paystackRecipientCode, reference, reason: `DOORSTEP payout ${reference.slice(-8)}` }, { fetchImpl })
    if (sent.status === 'success') return { payout: await applyTransferResult(db, reference, 'success'), unconfirmed: false }
    const otp = sent.status === 'otp'
    const updated = await db.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING', transferCode: sent.transferCode, failureReason: otp ? 'OTP_REQUIRED: finish it in the Paystack dashboard, or turn off transfer OTP in Paystack → Settings → Preferences' : null } })
    if (otp && source !== 'ADMIN') await notifyAdmins(db, { type: 'PAYMENT', title: 'Payout waiting for Paystack OTP', body: `${naira(payout.amountMinor)} payout ${reference} needs an OTP. Turn off transfer OTP in Paystack so automatic payouts and cash-outs go straight through.`, link: '/admin/finance' }).catch(() => undefined)
    return { payout: updated, unconfirmed: false }
  } catch (error) {
    if (transferCertainlyNotSent(error)) {
      await applyTransferResult(db, reference, 'failed', error.message)
      throw error
    }
    // Outcome unknown (timeout or Paystack error): keep the entries reserved so nobody pays them again.
    // The transfer webhook or the Check status button settles it with Paystack's real status.
    const pending = await db.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING', failureReason: 'UNCONFIRMED: Paystack did not confirm this transfer. Use Check status before paying again.' } })
    await notifyAdmins(db, { type: 'PAYMENT', title: 'Payout needs checking', body: `${naira(payout.amountMinor)} transfer ${reference} was not confirmed by Paystack. Press Check status on it before paying again.`, link: '/admin/finance' }).catch(() => undefined)
    return { payout: pending, unconfirmed: true }
  }
}

/**
 * Pays every business (or every rider) whose cleared balance reaches `minimumMinor`, by Paystack Transfer.
 * Automatic runs skip anyone with a transfer in flight or a recent automatic failure.
 */
export async function payParty(db, party, { holdHours, minimumMinor, source, actorId = null, respectBackoff = true, now = new Date(), fetchImpl, limit = 25 }) {
  const key = party === 'RIDER' ? 'riderId' : 'restaurantId'
  const owed = await db.ledgerEntry.groupBy({ by: [key], where: { party, status: 'DUE', [key]: { not: null } }, _sum: { amountMinor: true } })
  const summary = { paid: 0, paidMinor: 0, processing: 0, skipped: [] }
  for (const row of owed.filter((entry) => (entry._sum.amountMinor || 0) >= Math.max(100, minimumMinor)).slice(0, limit)) {
    const owner = { [key]: row[key] }
    try {
      if (respectBackoff) {
        const busy = await db.payout.findFirst({ where: { ...owner, OR: [{ status: { in: ['PENDING', 'PROCESSING'] } }, { status: 'FAILED', source: { in: AUTO_SOURCES }, createdAt: { gte: new Date(now.getTime() - AUTO_RETRY_AFTER_MS) } }] }, select: { id: true } })
        if (busy) { summary.skipped.push({ ...owner, reason: 'RECENT_OR_PENDING_PAYOUT' }); continue }
      }
      const account = await db.payoutAccount.findFirst({ where: owner })
      if (!account?.paystackRecipientCode || account.status !== 'ACTIVE') { summary.skipped.push({ ...owner, reason: 'NO_PAYOUT_ACCOUNT' }); continue }
      const balance = await availableBalance(db, { party, ...owner }, holdHours, now)
      if (balance.availableMinor < Math.max(100, minimumMinor)) { summary.skipped.push({ ...owner, reason: 'BELOW_MINIMUM_OR_ON_HOLD' }); continue }
      const result = await createPayout(db, { party, ...owner, entryIds: balance.entryIds, method: 'PAYSTACK_TRANSFER', source, actorId, account, fetchImpl })
      if (result.payout.status === 'PAID') { summary.paid += 1; summary.paidMinor += result.payout.amountMinor } else summary.processing += 1
    } catch (error) {
      summary.skipped.push({ ...owner, reason: error?.code || 'FAILED', message: error?.message })
    }
  }
  return summary
}

async function scheduleState(db) {
  const stored = await db.platformSetting.findUnique({ where: { key: PAYOUT_SCHEDULE_STATE_KEY } })
  return stored?.value && typeof stored.value === 'object' ? stored.value : {}
}
export async function markScheduleRun(db, party, momentIso) {
  const value = { ...(await scheduleState(db)), [party]: momentIso }
  await db.platformSetting.upsert({ where: { key: PAYOUT_SCHEDULE_STATE_KEY }, update: { value }, create: { key: PAYOUT_SCHEDULE_STATE_KEY, value } })
}

/**
 * Runs every minute. AUTOMATIC parties are paid as soon as money clears; SCHEDULED parties once per scheduled
 * time (a missed run, e.g. during a deploy, happens as soon as the server is back). MANUAL does nothing.
 */
export async function runPayoutSweep(db, { now = new Date(), fetchImpl } = {}) {
  if (!transfersEnabled()) return { skipped: 'TRANSFERS_OFF' }
  const settings = await getPayoutSettings(db)
  const results = {}
  for (const party of ['RESTAURANT', 'RIDER']) {
    const rule = ruleFor(settings, party)
    if (rule.mode === 'MANUAL') continue
    if (rule.mode === 'SCHEDULED') {
      const moment = lastScheduledMoment(now, rule).toISOString()
      if ((await scheduleState(db))[party] === moment) continue
      // Marked before paying: a crash mid-run leaves the rest for the next automatic or manual payout, never a double run.
      await markScheduleRun(db, party, moment)
    }
    const summary = await payParty(db, party, { holdHours: rule.holdHours, minimumMinor: rule.minimumMinor, source: rule.mode, now, fetchImpl })
    results[party] = summary
    if (rule.mode === 'SCHEDULED' && (summary.paid || summary.processing || summary.skipped.length)) {
      const missing = summary.skipped.filter((entry) => entry.reason === 'NO_PAYOUT_ACCOUNT').length
      const failed = summary.skipped.filter((entry) => !['NO_PAYOUT_ACCOUNT', 'BELOW_MINIMUM_OR_ON_HOLD', 'RECENT_OR_PENDING_PAYOUT'].includes(entry.reason)).length
      await notifyAdmins(db, { type: 'PAYMENT', title: `Scheduled ${party === 'RIDER' ? 'rider' : 'business'} payouts ran`, body: `${summary.paid} paid (${naira(summary.paidMinor)})${summary.processing ? `, ${summary.processing} processing` : ''}${missing ? `, ${missing} without a bank account` : ''}${failed ? `, ${failed} failed` : ''}.`, link: '/admin/finance' }).catch(() => undefined)
    }
  }
  return results
}

// Books and statements, built from the money ledger (LedgerEntry) and payouts — nothing is stored twice.
//
// How a payee's account works (riders and businesses):
//   + every earning recorded for them (delivery earning, business share, tip, adjustment) …
//   − DOORSTEP's fees on those earnings (rider fee, cash-out fee) are negative lines …
//   − every payout that left DOORSTEP (sent, waiting for their confirmation, disputed or still processing) …
//   − shares Paystack paid them directly at checkout (split payments) …
//   = what DOORSTEP owes them. At any moment this equals the sum of their "DUE" ledger lines.
// Lines that are voided (cancelled orders, failed payouts) are left out; earnings still waiting for a price are
// listed separately and don't count until an admin prices them.

export const LAGOS_OFFSET = '+01:00'
export const PAID_OUT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'AWAITING_CONFIRMATION', 'DISPUTED']
const PAYOUT_STATUS_TEXT = { PENDING: 'being sent', PROCESSING: 'being sent', PAID: 'paid', AWAITING_CONFIRMATION: 'sent — waiting for their confirmation', DISPUTED: 'sent — they reported a problem' }
const TYPE_TEXT = {
  RIDER_EARNING: 'Delivery earning', RIDER_SERVICE_FEE: 'DOORSTEP rider fee', TIP: 'Customer tip', PARTNER_SHARE: 'Sales share',
  ADJUSTMENT: 'Adjustment', WITHDRAWAL_FEE: 'Cash-out fee', BALANCE_CARRIED: 'Balance carried', DELIVERY: 'Delivery',
  ORDER_COMMISSION: 'Commission', SERVICE_FEE: 'Service fees', DELIVERY_FEE: 'Delivery fees', PARCEL_REVENUE: 'Parcel deliveries', PROMO_DISCOUNT: 'Promotions paid by DOORSTEP',
}
export const typeText = (type) => TYPE_TEXT[type] || String(type || '').toLowerCase().replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())

/** "2026-11-01".."2026-11-30" (Lagos days, inclusive) → [from, to) instants. Defaults to the current month. */
export function parsePeriod({ from, to } = {}, now = new Date()) {
  const valid = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00${LAGOS_OFFSET}`).getTime())
  const lagos = new Date(now.getTime() + 3_600_000)
  const monthStart = `${lagos.getUTCFullYear()}-${String(lagos.getUTCMonth() + 1).padStart(2, '0')}-01`
  const today = lagos.toISOString().slice(0, 10)
  const fromDay = valid(from) ? from : monthStart
  const toDay = valid(to) ? to : today
  const start = new Date(`${fromDay}T00:00:00${LAGOS_OFFSET}`)
  const end = new Date(new Date(`${toDay}T00:00:00${LAGOS_OFFSET}`).getTime() + 86_400_000)
  if (end <= start) throw Object.assign(new Error('The end date must be on or after the start date.'), { code: 'INVALID_PERIOD', status: 400 })
  if (end - start > 400 * 86_400_000) throw Object.assign(new Error('Choose a period of about a year or less.'), { code: 'INVALID_PERIOD', status: 400 })
  return { from: start, to: end, fromDay, toDay }
}

const counts = (entry) => entry.status !== 'VOID' && entry.status !== 'NEEDS_REVIEW'
const jobKey = (entry) => entry.orderId ? `order:${entry.orderId}` : entry.parcelBookingId ? `parcel:${entry.parcelBookingId}` : null

/**
 * A payee's statement for a period. entries/payouts are all of theirs (any date); refs maps
 * "order:<id>" / "parcel:<id>" to a readable number. Returns opening/closing balances, one line per job
 * (earning, fees and tip together), one line per payout, and the totals.
 */
export function buildStatement({ entries, payouts, from, to, refs = {} }) {
  const inPeriod = (date) => date >= from && date < to
  const before = (date) => date < from
  const sentPayouts = payouts.filter((payout) => PAID_OUT_STATUSES.includes(payout.status))
  const counted = entries.filter(counts)
  const splitSettled = counted.filter((entry) => entry.status === 'SETTLED_BY_SPLIT')

  let opening = 0
  for (const entry of counted) if (before(new Date(entry.createdAt))) opening += entry.amountMinor
  for (const entry of splitSettled) if (before(new Date(entry.createdAt))) opening -= entry.amountMinor
  for (const payout of sentPayouts) if (before(new Date(payout.createdAt))) opening -= payout.amountMinor

  // Group the period's earning lines by job.
  const groups = new Map()
  const lines = []
  for (const entry of counted.filter((row) => inPeriod(new Date(row.createdAt)))) {
    const key = jobKey(entry)
    if (!key || entry.type === 'WITHDRAWAL_FEE') { lines.push({ kind: 'ENTRY', date: new Date(entry.createdAt), ref: null, description: entry.description || typeText(entry.type), parts: [{ type: entry.type, label: typeText(entry.type), amountMinor: entry.amountMinor }], amountMinor: entry.amountMinor, payoutId: entry.payoutId || null }); continue }
    if (!groups.has(key)) { const line = { kind: 'JOB', key, date: new Date(entry.createdAt), ref: refs[key] || null, description: '', parts: [], amountMinor: 0 }; groups.set(key, line); lines.push(line) }
    const line = groups.get(key)
    if (new Date(entry.createdAt) < line.date) line.date = new Date(entry.createdAt)
    line.parts.push({ type: entry.type, label: typeText(entry.type), amountMinor: entry.amountMinor, description: entry.description })
    line.amountMinor += entry.amountMinor
  }
  for (const line of groups.values()) line.description = line.parts.find((part) => ['RIDER_EARNING', 'PARTNER_SHARE', 'DELIVERY'].includes(part.type))?.description || line.parts[0].description || typeText(line.parts[0].type)
  for (const entry of splitSettled.filter((row) => inPeriod(new Date(row.createdAt)))) {
    lines.push({ kind: 'SPLIT', date: new Date(entry.createdAt), ref: refs[jobKey(entry)] || null, description: 'Paid to your bank automatically at checkout (Paystack split)', parts: [], amountMinor: -entry.amountMinor })
  }
  for (const payout of sentPayouts.filter((row) => inPeriod(new Date(row.createdAt)))) {
    lines.push({ kind: 'PAYOUT', date: new Date(payout.createdAt), ref: payout.reference ? payout.reference.slice(-10) : null, description: `Payout ${PAYOUT_STATUS_TEXT[payout.status] || payout.status.toLowerCase()}${payout.method === 'MANUAL' ? ' (bank transfer)' : payout.method === 'PAYSTACK_TRANSFER' ? ' (Paystack transfer)' : ''}${payout.bankSnapshot?.bankName ? ` to ${payout.bankSnapshot.bankName} ••••${payout.bankSnapshot.accountLast4 || payout.bankSnapshot.last4 || ''}` : ''}`, parts: [], amountMinor: -payout.amountMinor, status: payout.status, payoutId: payout.id })
  }
  lines.sort((a, b) => a.date - b.date || (a.kind === 'PAYOUT') - (b.kind === 'PAYOUT'))
  let running = opening
  for (const line of lines) { running += line.amountMinor; line.balanceMinor = running }

  const sum = (filter) => lines.filter(filter).reduce((total, line) => total + line.amountMinor, 0)
  const earnedMinor = lines.filter((line) => line.kind === 'JOB' || line.kind === 'ENTRY').flatMap((line) => line.parts).filter((part) => part.amountMinor > 0).reduce((total, part) => total + part.amountMinor, 0)
  const feesMinor = -lines.filter((line) => line.kind === 'JOB' || line.kind === 'ENTRY').flatMap((line) => line.parts).filter((part) => part.amountMinor < 0).reduce((total, part) => total + part.amountMinor, 0)
  const awaitingPrice = entries.filter((entry) => entry.status === 'NEEDS_REVIEW').map((entry) => ({ date: new Date(entry.createdAt), ref: refs[jobKey(entry)] || null, description: entry.description }))
  return {
    openingMinor: opening,
    lines,
    totals: { jobs: groups.size, earnedMinor, feesMinor, netEarnedMinor: earnedMinor - feesMinor, paidOutMinor: -sum((line) => line.kind === 'PAYOUT'), paidBySplitMinor: -sum((line) => line.kind === 'SPLIT') },
    closingMinor: running,
    awaitingPrice,
  }
}

/** Loads one payee's ledger and builds the statement. kind: RIDER | RESTAURANT. */
export async function loadStatement(db, { kind, id }, period) {
  const owner = kind === 'RIDER' ? { riderId: id } : { restaurantId: id }
  const [entries, payouts] = await Promise.all([
    db.ledgerEntry.findMany({ where: { party: kind, ...owner }, orderBy: { createdAt: 'asc' }, select: { id: true, type: true, amountMinor: true, status: true, description: true, orderId: true, parcelBookingId: true, payoutId: true, createdAt: true } }),
    db.payout.findMany({ where: { party: kind, ...owner }, orderBy: { createdAt: 'asc' }, select: { id: true, amountMinor: true, feeMinor: true, method: true, status: true, reference: true, bankSnapshot: true, createdAt: true } }),
  ])
  const orderIds = [...new Set(entries.map((entry) => entry.orderId).filter(Boolean))]
  const parcelIds = [...new Set(entries.map((entry) => entry.parcelBookingId).filter(Boolean))]
  const [orders, parcels] = await Promise.all([
    orderIds.length ? db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } }) : [],
    parcelIds.length ? db.parcelBooking.findMany({ where: { id: { in: parcelIds } }, select: { id: true, reference: true } }) : [],
  ])
  const refs = { ...Object.fromEntries(orders.map((order) => [`order:${order.id}`, order.orderNumber])), ...Object.fromEntries(parcels.map((parcel) => [`parcel:${parcel.id}`, parcel.reference])) }
  const statement = buildStatement({ entries, payouts, from: period.from, to: period.to, refs })
  const owedNowMinor = entries.filter((entry) => entry.status === 'DUE').reduce((total, entry) => total + entry.amountMinor, 0)
  return { ...statement, owedNowMinor }
}

/** Everyone DOORSTEP owes or paid in a period, one row per rider or business. */
export async function payeeSummaries(db, kind, period) {
  const ownerKey = kind === 'RIDER' ? 'riderId' : 'restaurantId'
  const [due, earned, jobs, paid, review] = await Promise.all([
    db.ledgerEntry.groupBy({ by: [ownerKey], where: { party: kind, status: 'DUE' }, _sum: { amountMinor: true } }),
    db.ledgerEntry.groupBy({ by: [ownerKey], where: { party: kind, status: { notIn: ['VOID', 'NEEDS_REVIEW'] }, createdAt: { gte: period.from, lt: period.to } }, _sum: { amountMinor: true } }),
    db.ledgerEntry.groupBy({ by: [ownerKey, 'orderId', 'parcelBookingId'], where: { party: kind, status: 'DUE', type: { in: ['RIDER_EARNING', 'PARTNER_SHARE', 'DELIVERY'] } } }),
    db.payout.groupBy({ by: [ownerKey], where: { party: kind, status: { in: PAID_OUT_STATUSES }, createdAt: { gte: period.from, lt: period.to } }, _sum: { amountMinor: true }, _max: { createdAt: true } }),
    db.ledgerEntry.groupBy({ by: [ownerKey], where: { party: kind, status: 'NEEDS_REVIEW' }, _count: { _all: true } }),
  ])
  const ids = [...new Set([...due, ...earned, ...paid, ...review].map((row) => row[ownerKey]).filter(Boolean))]
  const people = kind === 'RIDER'
    ? (ids.length ? await db.rider.findMany({ where: { id: { in: ids } }, select: { id: true, user: { select: { firstName: true, lastName: true, phone: true } }, payoutAccount: { select: { bankName: true, accountLast4: true, paystackRecipientCode: true } } } }) : []).map((rider) => ({ id: rider.id, name: `${rider.user.firstName || ''} ${rider.user.lastName || ''}`.trim() || 'Rider', phone: rider.user.phone, account: rider.payoutAccount }))
    : (ids.length ? await db.restaurant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } }) : []).map((restaurant) => ({ id: restaurant.id, name: restaurant.name, phone: restaurant.phone, account: null }))
  const accounts = kind === 'RESTAURANT' && ids.length ? await db.payoutAccount.findMany({ where: { restaurantId: { in: ids } }, select: { restaurantId: true, bankName: true, accountLast4: true, paystackRecipientCode: true } }) : []
  const by = (rows, pick) => Object.fromEntries(rows.map((row) => [row[ownerKey], pick(row)]))
  const dueBy = by(due, (row) => row._sum.amountMinor || 0)
  const earnedBy = by(earned, (row) => row._sum.amountMinor || 0)
  const paidBy = by(paid, (row) => ({ amountMinor: row._sum.amountMinor || 0, lastAt: row._max.createdAt }))
  const reviewBy = by(review, (row) => row._count._all)
  const jobsBy = {}
  for (const row of jobs) jobsBy[row[ownerKey]] = (jobsBy[row[ownerKey]] || 0) + 1
  return people.map((person) => {
    const account = person.account || accounts.find((row) => row.restaurantId === person.id) || null
    return {
      id: person.id, name: person.name, phone: person.phone || null,
      bank: account ? { bankName: account.bankName, last4: account.accountLast4, transfersReady: Boolean(account.paystackRecipientCode) } : null,
      owedNowMinor: dueBy[person.id] || 0, unpaidJobs: jobsBy[person.id] || 0, awaitingPrice: reviewBy[person.id] || 0,
      earnedInPeriodMinor: earnedBy[person.id] || 0, paidInPeriodMinor: paidBy[person.id]?.amountMinor || 0, lastPaidAt: paidBy[person.id]?.lastAt || null,
    }
  }).sort((a, b) => b.owedNowMinor - a.owedNowMinor || a.name.localeCompare(b.name))
}

/** DOORSTEP's books for a period: money in, DOORSTEP's income, money out to partners and riders, what's owed. */
export async function booksSummary(db, period) {
  const range = { gte: period.from, lt: period.to }
  const [payments, platform, payoutRows, splitRows, owedRows, refundRows, reviewCount] = await Promise.all([
    db.payment.groupBy({ by: ['method'], where: { status: 'SUCCESSFUL', OR: [{ verifiedAt: range }, { verifiedAt: null, createdAt: range }] }, _sum: { amountMinor: true }, _count: { _all: true } }),
    db.ledgerEntry.groupBy({ by: ['type'], where: { party: 'PLATFORM', status: { notIn: ['VOID'] }, createdAt: range }, _sum: { amountMinor: true } }),
    db.payout.groupBy({ by: ['party'], where: { status: { in: PAID_OUT_STATUSES }, createdAt: range }, _sum: { amountMinor: true, feeMinor: true }, _count: { _all: true } }),
    db.ledgerEntry.groupBy({ by: ['party'], where: { status: 'SETTLED_BY_SPLIT', createdAt: range }, _sum: { amountMinor: true } }),
    db.ledgerEntry.groupBy({ by: ['party'], where: { status: 'DUE', party: { in: ['RIDER', 'RESTAURANT'] } }, _sum: { amountMinor: true } }),
    db.ledgerEntry.groupBy({ by: ['type'], where: { type: { in: ['REFUND_REQUIRED', 'DUPLICATE_PAYMENT_REFUND_REQUIRED'] }, status: { notIn: ['VOID', 'PAID'] } }, _sum: { amountMinor: true }, _count: { _all: true } }),
    db.ledgerEntry.count({ where: { status: 'NEEDS_REVIEW' } }),
  ])
  const pick = (rows, key, value) => rows.find((row) => row[key] === value)
  const income = platform.map((row) => ({ type: row.type, label: typeText(row.type), amountMinor: row._sum.amountMinor || 0 })).filter((row) => row.amountMinor !== 0).sort((a, b) => b.amountMinor - a.amountMinor)
  return {
    period: { from: period.fromDay, to: period.toDay },
    moneyIn: { totalMinor: payments.reduce((sum, row) => sum + (row._sum.amountMinor || 0), 0), payments: payments.reduce((sum, row) => sum + row._count._all, 0), byMethod: payments.map((row) => ({ method: row.method, amountMinor: row._sum.amountMinor || 0, count: row._count._all })) },
    income: { totalMinor: income.reduce((sum, row) => sum + row.amountMinor, 0), lines: income },
    paidOut: {
      ridersMinor: pick(payoutRows, 'party', 'RIDER')?._sum.amountMinor || 0, riderPayouts: pick(payoutRows, 'party', 'RIDER')?._count._all || 0,
      businessesMinor: pick(payoutRows, 'party', 'RESTAURANT')?._sum.amountMinor || 0, businessPayouts: pick(payoutRows, 'party', 'RESTAURANT')?._count._all || 0,
      businessesBySplitMinor: pick(splitRows, 'party', 'RESTAURANT')?._sum.amountMinor || 0,
    },
    owedNow: { ridersMinor: pick(owedRows, 'party', 'RIDER')?._sum.amountMinor || 0, businessesMinor: pick(owedRows, 'party', 'RESTAURANT')?._sum.amountMinor || 0 },
    refundsOwed: { amountMinor: Math.abs(refundRows.reduce((sum, row) => sum + (row._sum.amountMinor || 0), 0)), count: refundRows.reduce((sum, row) => sum + row._count._all, 0) },
    awaitingPrice: reviewCount,
  }
}

/* ------------------------------ CSV ------------------------------ */
// Text cells that start with = + - @ are prefixed so spreadsheet apps never run them as formulas.
const cell = (value) => {
  if (value == null) return ''
  if (typeof value === 'number') return String(value)
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
export const toCsv = (rows) => `﻿${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`
export const naira = (minor) => Math.round(Number(minor || 0)) / 100
const day = (date) => new Date(new Date(date).getTime() + 3_600_000).toISOString().slice(0, 16).replace('T', ' ')

export function statementCsv({ name, kind, period, statement }) {
  const rows = [
    [`DOORSTEP statement — ${name} (${kind === 'RIDER' ? 'rider' : 'business'})`],
    [`Period`, `${period.fromDay} to ${period.toDay}`],
    [`Amounts in naira (NGN). Times are Lagos time.`],
    [],
    ['Date', 'Reference', 'Description', 'Earned', 'Fees', 'Paid out', 'Balance owed'],
    ['', '', 'Opening balance', '', '', '', naira(statement.openingMinor)],
  ]
  for (const line of statement.lines) {
    const plus = line.parts.filter((part) => part.amountMinor > 0).reduce((sum, part) => sum + part.amountMinor, 0)
    const minus = -line.parts.filter((part) => part.amountMinor < 0).reduce((sum, part) => sum + part.amountMinor, 0)
    const out = line.kind === 'PAYOUT' || line.kind === 'SPLIT' ? -line.amountMinor : 0
    rows.push([day(line.date), line.ref || '', line.description, plus ? naira(plus) : '', minus ? naira(minus) : '', out ? naira(out) : '', naira(line.balanceMinor)])
  }
  rows.push(['', '', 'Closing balance', naira(statement.totals.earnedMinor), naira(statement.totals.feesMinor), naira(statement.totals.paidOutMinor + statement.totals.paidBySplitMinor), naira(statement.closingMinor)])
  if (statement.awaitingPrice.length) { rows.push([]); rows.push(['Waiting for DOORSTEP to set the price (not included above)']); for (const row of statement.awaitingPrice) rows.push([day(row.date), row.ref || '', row.description]) }
  return toCsv(rows)
}

/** Every ledger line and payout in a period, for an accountant (general journal). */
export async function journalCsv(db, period) {
  const range = { gte: period.from, lt: period.to }
  const [entries, payouts] = await Promise.all([
    db.ledgerEntry.findMany({ where: { createdAt: range }, orderBy: { createdAt: 'asc' }, take: 50_000, select: { id: true, party: true, restaurantId: true, riderId: true, orderId: true, parcelBookingId: true, type: true, amountMinor: true, status: true, description: true, payoutId: true, createdAt: true } }),
    db.payout.findMany({ where: { createdAt: range }, orderBy: { createdAt: 'asc' }, take: 20_000, select: { id: true, party: true, restaurantId: true, riderId: true, amountMinor: true, feeMinor: true, method: true, source: true, status: true, reference: true, createdAt: true, completedAt: true } }),
  ])
  const orderIds = [...new Set(entries.map((entry) => entry.orderId).filter(Boolean))]
  const riderIds = [...new Set([...entries, ...payouts].map((row) => row.riderId).filter(Boolean))]
  const restaurantIds = [...new Set([...entries, ...payouts].map((row) => row.restaurantId).filter(Boolean))]
  const [orders, riders, restaurants] = await Promise.all([
    orderIds.length ? db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } }) : [],
    riderIds.length ? db.rider.findMany({ where: { id: { in: riderIds } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }) : [],
    restaurantIds.length ? db.restaurant.findMany({ where: { id: { in: restaurantIds } }, select: { id: true, name: true } }) : [],
  ])
  const orderNo = Object.fromEntries(orders.map((row) => [row.id, row.orderNumber]))
  const who = { ...Object.fromEntries(riders.map((row) => [row.id, `${row.user.firstName || ''} ${row.user.lastName || ''}`.trim()])), ...Object.fromEntries(restaurants.map((row) => [row.id, row.name])) }
  const partyText = { PLATFORM: 'DOORSTEP', RIDER: 'Rider', RESTAURANT: 'Business' }
  const rows = [[`DOORSTEP general journal ${period.fromDay} to ${period.toDay} (NGN, Lagos time)`], [], ['Date', 'Record', 'Party', 'Name', 'Type', 'Order', 'Description', 'Amount', 'Status', 'Payout', 'Record ID']]
  for (const entry of entries) rows.push([day(entry.createdAt), 'Ledger', partyText[entry.party] || entry.party, who[entry.riderId || entry.restaurantId] || '', typeText(entry.type), orderNo[entry.orderId] || '', entry.description, naira(entry.amountMinor), entry.status, entry.payoutId || '', entry.id])
  for (const payout of payouts) rows.push([day(payout.createdAt), 'Payout', partyText[payout.party] || payout.party, who[payout.riderId || payout.restaurantId] || '', `Payout (${payout.method === 'MANUAL' ? 'bank transfer' : 'Paystack transfer'}, ${String(payout.source).toLowerCase()})`, '', `Reference ${payout.reference}${payout.feeMinor ? `; cash-out fee ${naira(payout.feeMinor)}` : ''}`, naira(-payout.amountMinor), payout.status, payout.id, payout.id])
  return toCsv(rows)
}

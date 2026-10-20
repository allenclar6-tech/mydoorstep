// Live delivery handling, Glovo-style: once a business accepts an order, DOORSTEP offers it to the nearest free
// online rider for a short window. If they decline or the window passes, the next rider gets it. Riders who
// already passed are skipped for a few minutes; if nobody can take it, the order stays in the open pool that
// every online rider can see, and DOORSTEP admins are alerted when an order waits too long.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const OFFER_SECONDS = 45
export const MAX_DISPATCH_KM = 10
export const RIDER_LOCATION_FRESH_MS = 30 * 60_000
export const SKIP_AFTER_PASS_MS = 3 * 60_000
export const STUCK_AFTER_MS = 10 * 60_000
export const DISPATCHABLE_ORDER_STATUSES = ['RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']
const ACTIVE_DELIVERY_STATUSES = ['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER']

// Sapele road travel: straight line × detour, at a typical motorbike speed through town.
export const DETOUR = 1.35
export const RIDER_KMH = 18
export const DEFAULT_PREP_MINUTES = 20
export const HANDOVER_MINUTES = 3

export function haversineMeters(a, b) {
  const rad = (value) => value * Math.PI / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}
export const point = (value) => value && Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude)) && !(Number(value.latitude) === 0 && Number(value.longitude) === 0) ? { latitude: Number(value.latitude), longitude: Number(value.longitude) } : null
export const travelMinutes = (a, b) => (a && b ? Math.max(2, Math.round(haversineMeters(a, b) * DETOUR / 1000 / RIDER_KMH * 60)) : null)

/** Where a rider is: the location shared when going online, or the latest live ping — only if recent. */
export function riderPosition(rider, latestPing, now = Date.now()) {
  const fromAvailability = rider.availabilityLocatedAt && now - new Date(rider.availabilityLocatedAt).getTime() <= RIDER_LOCATION_FRESH_MS ? point({ latitude: rider.availabilityLatitude, longitude: rider.availabilityLongitude }) : null
  const fromPing = latestPing && now - new Date(latestPing.recordedAt).getTime() <= RIDER_LOCATION_FRESH_MS ? point(latestPing) : null
  if (fromAvailability && fromPing) return new Date(latestPing.recordedAt) > new Date(rider.availabilityLocatedAt) ? fromPing : fromAvailability
  return fromPing || fromAvailability
}

/**
 * Ranks riders for one pickup: nearest first (within MAX_DISPATCH_KM), riders without a recent location after
 * them, and the rider who has waited longest since going online breaks ties.
 */
export function rankRiders(candidates, pickup, { maxKm = MAX_DISPATCH_KM } = {}) {
  return candidates
    .map((candidate) => ({ ...candidate, distanceMeters: candidate.position && pickup ? Math.round(haversineMeters(candidate.position, pickup)) : null }))
    .filter((candidate) => candidate.distanceMeters == null || candidate.distanceMeters <= maxKm * 1000)
    .sort((a, b) => {
      if (a.distanceMeters == null && b.distanceMeters != null) return 1
      if (b.distanceMeters == null && a.distanceMeters != null) return -1
      if (a.distanceMeters != null && b.distanceMeters != null && a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters
      return new Date(a.onlineSince || 0).getTime() - new Date(b.onlineSince || 0).getTime()
    })
}

/**
 * Arrival estimate for the customer. Before pickup it waits for whichever is later — the food being ready or
 * the rider reaching the store — then adds the ride to the customer and a short handover.
 */
export function estimateArrival({ orderStatus, deliveryStatus, now = Date.now(), acceptedAt, prepMinutes, riderPoint, storePoint, customerPoint }) {
  const minutesFromNow = (date) => Math.max(1, Math.round((date - now) / 60_000))
  const toCustomerFrom = (from) => travelMinutes(from, customerPoint) ?? 10
  if (['DELIVERED', 'CANCELLED', 'REJECTED', 'REFUNDED', 'PENDING_PAYMENT'].includes(orderStatus)) return null
  if (orderStatus === 'PAID') return { stage: 'WAITING_FOR_STORE', minutes: null, arriveBy: null, live: false }
  const pickedUp = ['PICKED_UP', 'GOING_TO_CUSTOMER'].includes(deliveryStatus) || ['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(orderStatus)
  if (pickedUp) {
    const at = now + (toCustomerFrom(riderPoint || storePoint) + HANDOVER_MINUTES) * 60_000
    return { stage: 'ON_THE_WAY', minutes: minutesFromNow(at), arriveBy: new Date(at).toISOString(), live: Boolean(riderPoint) }
  }
  const prep = prepMinutes || DEFAULT_PREP_MINUTES
  const foodReady = orderStatus === 'READY_FOR_PICKUP' ? now : Math.max(now, new Date(acceptedAt || now).getTime() + prep * 60_000)
  const riderAtStore = now + (riderPoint ? travelMinutes(riderPoint, storePoint) ?? 10 : 10) * 60_000
  const pickupAt = Math.max(foodReady, riderAtStore)
  const at = pickupAt + (toCustomerFrom(storePoint) + HANDOVER_MINUTES) * 60_000
  return { stage: deliveryStatus && ['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT'].includes(deliveryStatus) ? 'RIDER_TO_STORE' : 'PREPARING', minutes: minutesFromNow(at), arriveBy: new Date(at).toISOString(), live: Boolean(riderPoint) }
}

/* ------------------------------ delivery code ------------------------------ */
// Proof of delivery: the customer reads a 4-digit code to the rider, who must enter it to finish. The code is
// derived (HMAC) from the delivery id with a server secret, so it is never stored and can't leak through any
// API that returns delivery rows to riders or businesses.
let codeSecret = null
export async function deliveryCodeSecret(db) {
  if (codeSecret) return codeSecret
  if (process.env.DELIVERY_CODE_SECRET) return (codeSecret = process.env.DELIVERY_CODE_SECRET)
  const key = 'delivery_code_secret'
  const existing = await db.platformSetting.findUnique({ where: { key } })
  if (existing?.value?.secret) return (codeSecret = existing.value.secret)
  const secret = randomBytes(32).toString('hex')
  const saved = await db.platformSetting.upsert({ where: { key }, update: {}, create: { key, value: { secret } } })
  return (codeSecret = saved.value.secret)
}
export function deliveryCodeFor(deliveryId, secret) {
  const digest = createHmac('sha256', secret).update(`delivery:${deliveryId}`).digest()
  return String(digest.readUInt32BE(0) % 10_000).padStart(4, '0')
}
export function codeMatches(input, expected) {
  const given = Buffer.from(String(input || '').replace(/\D/g, '').padEnd(4, 'x').slice(0, 4))
  return given.length === 4 && timingSafeEqual(given, Buffer.from(expected))
}
export const MAX_CODE_ATTEMPTS = 5

/* --------------------------------- dispatch -------------------------------- */
const naira = (minor) => `₦${Math.round((minor || 0) / 100).toLocaleString('en-NG')}`

async function freeOnlineRiders(db, { restaurantId, businessOnly, excludeIds, now = new Date() }) {
  const riders = await db.rider.findMany({
    where: {
      status: 'APPROVED',
      availability: 'ONLINE',
      id: { notIn: excludeIds },
      ...(businessOnly ? { network: 'BUSINESS_OWNED', restaurantId } : { network: 'DOORSTEP_POOL' }),
      deliveries: { none: { status: { in: ACTIVE_DELIVERY_STATUSES } } },
    },
    select: { id: true, userId: true, availabilityLatitude: true, availabilityLongitude: true, availabilityLocatedAt: true, availabilityChangedAt: true },
    take: 60,
  })
  if (!riders.length) return []
  // Riders already holding another open offer are busy deciding.
  const holding = await db.delivery.findMany({ where: { status: 'REQUESTED', requestedRiderId: { in: riders.map((rider) => rider.id) }, requestExpiresAt: { gt: now } }, select: { requestedRiderId: true } })
  const busy = new Set(holding.map((row) => row.requestedRiderId))
  const free = riders.filter((rider) => !busy.has(rider.id))
  const pings = await Promise.all(free.map((rider) => db.riderLocation.findFirst({ where: { riderId: rider.id }, orderBy: { recordedAt: 'desc' }, select: { latitude: true, longitude: true, recordedAt: true } })))
  return free.map((rider, index) => ({ riderId: rider.id, userId: rider.userId, position: riderPosition(rider, pings[index], now.getTime()), onlineSince: rider.availabilityChangedAt }))
}

/**
 * Offers one food delivery to the best free rider. Safe to call repeatedly and from several places: every
 * write is conditional, so a delivery is never offered to two riders at once.
 */
export async function dispatchDelivery(db, deliveryId, { now = new Date(), notifyUsers } = {}) {
  const delivery = await db.delivery.findUnique({
    where: { id: deliveryId },
    include: { order: { select: { id: true, orderNumber: true, status: true, restaurantId: true, addressSnapshot: true, plannedRiderPayMinor: true, deliveryQuote: true, restaurant: { select: { name: true, latitude: true, longitude: true, application: { select: { deliveryPreference: true } } } } } } },
  })
  if (!delivery?.order || delivery.riderId) return { offered: false, reason: 'NOT_DISPATCHABLE' }
  if (!DISPATCHABLE_ORDER_STATUSES.includes(delivery.order.status)) return { offered: false, reason: 'ORDER_NOT_READY_FOR_DISPATCH' }
  if (delivery.status === 'REQUESTED' && delivery.requestExpiresAt && delivery.requestExpiresAt > now) return { offered: false, reason: 'OFFER_PENDING' }
  if (!['AVAILABLE', 'REQUESTED'].includes(delivery.status)) return { offered: false, reason: 'NOT_DISPATCHABLE' }

  const recent = await db.dispatchOffer.findMany({ where: { deliveryId, offeredAt: { gt: new Date(now.getTime() - SKIP_AFTER_PASS_MS) } }, select: { riderId: true } })
  const excludeIds = [...new Set(recent.map((row) => row.riderId))]
  const pickup = point(delivery.order.restaurant)
  const ownRiders = delivery.order.restaurant.application?.deliveryPreference === 'OWN_RIDERS'
  let ranked = ownRiders ? rankRiders(await freeOnlineRiders(db, { restaurantId: delivery.order.restaurantId, businessOnly: true, excludeIds, now }), pickup) : []
  if (!ranked.length) ranked = rankRiders(await freeOnlineRiders(db, { restaurantId: delivery.order.restaurantId, businessOnly: false, excludeIds, now }), pickup)

  const releaseExpired = () => db.delivery.updateMany({ where: { id: deliveryId, status: 'REQUESTED', riderId: null, requestExpiresAt: { lte: now } }, data: { status: 'AVAILABLE', requestedRiderId: null, requestExpiresAt: null } })
  if (!ranked.length) { await releaseExpired(); return { offered: false, reason: 'NO_FREE_RIDER' } }

  const chosen = ranked[0]
  const expiresAt = new Date(now.getTime() + OFFER_SECONDS * 1000)
  const claimed = await db.delivery.updateMany({
    where: { id: deliveryId, riderId: null, OR: [{ status: 'AVAILABLE' }, { status: 'REQUESTED', requestExpiresAt: { lte: now } }] },
    data: { status: 'REQUESTED', requestedRiderId: chosen.riderId, requestExpiresAt: expiresAt, requestedAt: now },
  })
  if (claimed.count !== 1) return { offered: false, reason: 'STATE_CHANGED' }
  await db.dispatchOffer.create({ data: { deliveryId, riderId: chosen.riderId, status: 'OFFERED', distanceMeters: chosen.distanceMeters, offeredAt: now, expiresAt } })
  const pay = delivery.order.plannedRiderPayMinor
  const km = delivery.order.deliveryQuote?.km
  const away = chosen.distanceMeters != null ? `${(chosen.distanceMeters / 1000).toFixed(1)} km from you` : 'near you'
  if (notifyUsers) await notifyUsers(db, [chosen.userId], { type: 'DELIVERY', title: pay ? `New delivery · you earn ${naira(pay)}` : 'New delivery request', body: `${delivery.order.restaurant.name} (${away})${km ? ` → ${km} km trip` : ''}. Accept within ${OFFER_SECONDS} seconds.`, link: '/rider/dashboard' })
  return { offered: true, riderId: chosen.riderId, expiresAt, distanceMeters: chosen.distanceMeters }
}

/**
 * Background pass (every few seconds): expires unanswered offers and moves on, retries orders still waiting
 * for a rider, and alerts admins about orders stuck without a rider.
 */
export async function sweepDispatch(db, { now = new Date(), notifyUsers, notifyAdmins } = {}) {
  const expired = await db.delivery.findMany({ where: { status: 'REQUESTED', riderId: null, requestExpiresAt: { lte: now }, orderId: { not: null } }, select: { id: true, requestedRiderId: true }, take: 50 })
  for (const delivery of expired) {
    await db.dispatchOffer.updateMany({ where: { deliveryId: delivery.id, riderId: delivery.requestedRiderId, status: 'OFFERED' }, data: { status: 'EXPIRED', respondedAt: now } })
  }
  const waiting = await db.delivery.findMany({
    where: { riderId: null, orderId: { not: null }, OR: [{ status: 'AVAILABLE' }, { status: 'REQUESTED', requestExpiresAt: { lte: now } }], order: { status: { in: DISPATCHABLE_ORDER_STATUSES } } },
    select: { id: true, stuckAlertedAt: true, order: { select: { orderNumber: true, acceptedAt: true, paidAt: true, restaurant: { select: { name: true } } } } },
    take: 50,
  })
  let offered = 0
  for (const delivery of waiting) {
    const result = await dispatchDelivery(db, delivery.id, { now, notifyUsers })
    if (result.offered) offered += 1
    const since = delivery.order.acceptedAt || delivery.order.paidAt
    if (!result.offered && !delivery.stuckAlertedAt && since && now - new Date(since) > STUCK_AFTER_MS) {
      const marked = await db.delivery.updateMany({ where: { id: delivery.id, stuckAlertedAt: null }, data: { stuckAlertedAt: now } })
      if (marked.count === 1 && notifyAdmins) await notifyAdmins(db, { type: 'DELIVERY', title: 'Order waiting for a rider', body: `${delivery.order.orderNumber} from ${delivery.order.restaurant.name} has had no rider for over ${Math.round(STUCK_AFTER_MS / 60_000)} minutes. Open Live deliveries to assign one.`, link: '/admin/deliveries' })
    }
  }
  return { expired: expired.length, waiting: waiting.length, offered }
}

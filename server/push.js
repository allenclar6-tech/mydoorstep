// Phone/computer push notifications (Web Push), like the alerts delivery apps show in the notification bar.
// Every in-app notification is also pushed to the person's subscribed devices by a small background loop, so all
// existing places that create notifications get pushes without changes. Keys are created once and kept in
// PlatformSetting (private key never leaves the server); WEB_PUSH_PUBLIC_KEY/WEB_PUSH_PRIVATE_KEY can override.

import { generateVapidKeys, sendPush } from './webPushCore.js'

const KEY = 'web_push_vapid'
const CONTACT = process.env.WEB_PUSH_CONTACT || 'mailto:support@mydoorstep.com.co'
let keysCache = null

export async function vapidKeys(db) {
  if (keysCache) return keysCache
  if (process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY) return (keysCache = { publicKey: process.env.WEB_PUSH_PUBLIC_KEY, privateKey: process.env.WEB_PUSH_PRIVATE_KEY })
  const stored = await db.platformSetting.findUnique({ where: { key: KEY } })
  if (stored?.value?.publicKey && stored?.value?.privateKey) return (keysCache = stored.value)
  const generated = generateVapidKeys()
  const saved = await db.platformSetting.upsert({ where: { key: KEY }, update: {}, create: { key: KEY, value: generated } })
  return (keysCache = saved.value)
}

/** Short, friendly text for the phone notification (the in-app text stays as it is). */
export function pushPayload(notification) {
  return JSON.stringify({ title: notification.title, body: notification.body, link: notification.link || '/', tag: notification.id, type: notification.type })
}

/** Sends pushes for new notifications. Runs every few seconds; each notification is pushed once. */
export async function sendPendingPushes(db, { now = new Date(), batch = 100, fetchImpl } = {}) {
  const keys = await vapidKeys(db)
  if (!keys) return { sent: 0, skipped: 'NO_KEYS' }
  const pending = await db.notification.findMany({ where: { pushedAt: null, createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } }, orderBy: { createdAt: 'asc' }, take: batch })
  if (!pending.length) return { sent: 0 }
  // Mark first so a slow push service can never cause the same alert to be sent twice.
  await db.notification.updateMany({ where: { id: { in: pending.map((row) => row.id) } }, data: { pushedAt: now } })
  const userIds = [...new Set(pending.map((row) => row.userId))]
  const subscriptions = await db.pushSubscription.findMany({ where: { userId: { in: userIds } } })
  let sent = 0
  for (const notification of pending) {
    for (const subscription of subscriptions.filter((entry) => entry.userId === notification.userId)) {
      try {
        await sendPush({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, pushPayload(notification), { keys, contact: CONTACT, ttl: 60 * 60, urgency: notification.type === 'DELIVERY' || notification.type === 'ORDER' ? 'high' : 'normal', fetchImpl })
        sent += 1
        await db.pushSubscription.update({ where: { id: subscription.id }, data: { lastUsedAt: now } }).catch(() => undefined)
      } catch (error) {
        // 404/410: the person removed permission or the browser dropped the subscription.
        if (error?.statusCode === 404 || error?.statusCode === 410) await db.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined)
      }
    }
  }
  return { sent }
}

/** One friendly reminder for an order left unpaid for 30 minutes (like “You’ve got an order pending…”). */
export async function remindUnpaidOrders(db, { now = new Date() } = {}) {
  const orders = await db.order.findMany({
    where: { status: 'PENDING_PAYMENT', paymentReminderAt: null, customerHiddenAt: null, createdAt: { lte: new Date(now.getTime() - 30 * 60_000), gte: new Date(now.getTime() - 3 * 60 * 60_000) } },
    select: { id: true, customerId: true, restaurant: { select: { name: true } }, customer: { select: { firstName: true, preferredName: true } } },
    take: 50,
  })
  for (const order of orders) {
    const claimed = await db.order.updateMany({ where: { id: order.id, paymentReminderAt: null }, data: { paymentReminderAt: now } })
    if (claimed.count !== 1) continue
    const name = order.customer?.preferredName || order.customer?.firstName
    await db.notification.create({ data: { userId: order.customerId, type: 'ORDER', title: 'You’ve got an order waiting', body: `Finish paying for your order from ${order.restaurant?.name || 'your store'}${name ? `, ${name}` : ''} 👉`, link: `/account/orders/${order.id}` } })
  }
  return orders.length
}

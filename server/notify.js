// In-app notifications. Every helper takes a Prisma client or transaction so a notification
// is only written when the change it describes is committed.

import { areaForPath, can } from './staff.js'

const MAX_TITLE = 120
const MAX_BODY = 500

const clean = ({ type, title, body, link = null }) => ({
  type,
  title: String(title).slice(0, MAX_TITLE),
  body: String(body).slice(0, MAX_BODY),
  link: link && /^\/(?!\/)/.test(link) ? link.slice(0, 200) : null,
})

export async function notifyUsers(db, userIds, notification) {
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return 0
  const data = clean(notification)
  const result = await db.notification.createMany({ data: ids.map((userId) => ({ userId, ...data })) })
  return result.count
}

/** Active staff; with `area`, only staff whose role covers it (e.g. 'finance'). */
export async function adminIds(db, area = null) {
  const admins = await db.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true, role: true, adminRole: true }, take: 50 })
  return admins.filter((admin) => !area || can({ ...admin, role: 'ADMIN' }, area)).map((admin) => admin.id)
}

/**
 * Tells staff about something that needs them. It goes to the staff whose role covers the page it links to
 * (a road report reaches delivery managers, a payout reaches finance), so nobody is alerted about a page they
 * can't open. Alerts without an admin link go to every admin.
 */
export async function notifyAdmins(db, notification) {
  const link = typeof notification?.link === 'string' ? notification.link : ''
  return notifyUsers(db, await adminIds(db, link.startsWith('/admin/') ? areaForPath(link) : null), notification)
}

export async function restaurantTeamIds(db, restaurantId) {
  if (!restaurantId) return []
  const members = await db.restaurantUser.findMany({ where: { restaurantId }, select: { userId: true } })
  return members.map((member) => member.userId)
}

/** Approved, online riders who may take a job: the shared pool plus the business's own riders. */
export async function availableRiderUserIds(db, { restaurantId = null } = {}) {
  const riders = await db.rider.findMany({
    where: { status: 'APPROVED', availability: 'ONLINE', OR: [{ network: 'DOORSTEP_POOL' }, ...(restaurantId ? [{ network: 'BUSINESS_OWNED', restaurantId }] : [])] },
    select: { userId: true },
    take: 40,
  })
  return riders.map((rider) => rider.userId)
}

/* ---------- welcome messages ---------- */
const WELCOME_PREFIX = 'Welcome to'

/** A first message written for each kind of account, so nobody lands on an empty inbox. */
export function welcomeMessage(role, { firstName = '', businessName = '', storeType = 'RESTAURANT' } = {}) {
  const name = String(firstName || '').trim()
  if (role === 'CUSTOMER') return {
    type: 'ACCOUNT', link: '/location',
    title: `Welcome to DOORSTEP${name ? `, ${name}` : ''}!`,
    body: 'Meals, groceries and packages across Sapele, brought to your door. Start by setting your delivery address so we can show you who delivers to you. Order updates, rider arrivals and receipts will all appear here.',
  }
  if (role === 'RESTAURANT') {
    const grocery = storeType === 'GROCERY'
    return {
      type: 'ACCOUNT', link: '/partner/application-status',
      title: `Welcome to DOORSTEP, ${businessName || name || 'partner'}`,
      body: grocery
        ? 'Thanks for bringing your store to DOORSTEP. Our team is reviewing your application and will tell you here as soon as there is a decision. While you wait, get product photos and prices ready so you can go live quickly.'
        : 'Thanks for bringing your kitchen to DOORSTEP. Our team is reviewing your application and will tell you here as soon as there is a decision. While you wait, get dish photos and prices ready so you can go live quickly.',
    }
  }
  if (role === 'RIDER') return {
    type: 'ACCOUNT', link: '/rider/application-status',
    title: `Welcome to the DOORSTEP crew${name ? `, ${name}` : ''}`,
    body: 'We are checking your documents and will tell you here when you are approved. After that, go online from your dashboard and new pickups near you will show up here instantly.',
  }
  if (role === 'ADMIN') return {
    type: 'ACCOUNT', link: '/admin/dashboard',
    title: `Welcome to the DOORSTEP control centre${name ? `, ${name}` : ''}`,
    body: 'New partner and rider applications, bank transfers to confirm, refund reviews and support tickets will all reach you here as they happen.',
  }
  return null
}

/** Sends the welcome message once per account. Safe to call repeatedly. */
export async function sendWelcome(db, user, context = {}) {
  const message = welcomeMessage(user.role, { firstName: user.firstName, ...context })
  if (!message) return false
  const existing = await db.notification.findFirst({ where: { userId: user.id, type: 'ACCOUNT', title: { startsWith: WELCOME_PREFIX } }, select: { id: true } })
  if (existing) return false
  await notifyUsers(db, [user.id], message)
  return true
}

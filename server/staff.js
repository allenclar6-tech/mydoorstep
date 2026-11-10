import { Router } from 'express'
import { z } from 'zod'

// DOORSTEP staff roles. Every admin account is a User with role ADMIN plus a staff role (User.adminRole).
// Admin accounts created before staff roles existed have no adminRole and keep full access (Super admin).
//
// Access is checked on the server for every /api/admin/* request (one guard for all of them, so no admin
// endpoint can be missed) and for the few admin views outside /api/admin (support desk, live tracking,
// parcels, location reviews). Unknown admin areas are Super-admin only.

export const STAFF_ROLES = ['SUPER_ADMIN', 'DELIVERY_MANAGER', 'PRICING_MANAGER', 'FINANCE_ADMIN', 'DISPATCH_OPERATOR']
export const ROLE_TEXT = {
  SUPER_ADMIN: { name: 'Super admin', does: 'Everything, including staff, settings and switching on demand-based pricing.' },
  DELIVERY_MANAGER: { name: 'Delivery manager', does: 'Deliveries, prices to confirm, rider price checks, dispatch, road reports and areas.' },
  PRICING_MANAGER: { name: 'Pricing manager', does: 'Delivery prices, areas, business delivery deals, promotions and prices to confirm.' },
  FINANCE_ADMIN: { name: 'Finance admin', does: 'Money, payouts, refunds, books and statements.' },
  DISPATCH_OPERATOR: { name: 'Dispatch operator', does: 'Live deliveries, assigning riders, order chats and customer help.' },
}

/** What each area covers. Areas group admin pages and their APIs. */
export const ROLE_AREAS = {
  SUPER_ADMIN: ['overview', 'dispatch', 'quotes', 'pricing', 'zones', 'routes', 'finance', 'support', 'people', 'system'],
  DELIVERY_MANAGER: ['overview', 'dispatch', 'quotes', 'zones', 'routes', 'support'],
  PRICING_MANAGER: ['overview', 'pricing', 'zones', 'quotes'],
  FINANCE_ADMIN: ['overview', 'finance'],
  DISPATCH_OPERATOR: ['overview', 'dispatch', 'support'],
}

// First path segment after /admin/ → area. Used for the API (/api/admin/<segment>) and the admin pages (/admin/<segment>).
const SEGMENT_AREA = {
  // overview (every staff member)
  me: 'overview', summary: 'overview', todo: 'overview', dashboard: 'overview', notifications: 'overview', download: 'overview',
  // dispatch
  dispatch: 'dispatch', deliveries: 'dispatch', orders: 'dispatch', parcels: 'dispatch', chats: 'dispatch', 'delivery-overview': 'dispatch', 'delivery-failure-reasons': 'dispatch',
  // quotations
  'delivery-quotes': 'quotes', 'delivery-quotes-summary': 'quotes',
  // pricing
  'delivery-pricing': 'pricing', 'parcel-pricing': 'pricing', pricing: 'pricing', promos: 'pricing', 'merchant-deals': 'pricing', 'pricing-schedule': 'pricing',
  // zones and places
  locations: 'zones', 'service-areas': 'zones',
  // route verification
  'location-reviews': 'routes', 'road-reports': 'routes',
  // money
  finance: 'finance', 'finance-summary': 'finance', books: 'finance', 'bank-transfers': 'finance', refunds: 'finance', payments: 'finance', analytics: 'finance', withdrawals: 'finance',
  // customers and help
  customers: 'support', reviews: 'support', support: 'support',
  // people (applications and accounts)
  applications: 'people', verification: 'people', restaurants: 'people', groceries: 'people', riders: 'people',
  // system
  settings: 'system', 'payment-settings': 'system', 'audit-logs': 'system', staff: 'system', documents: 'system',
}

export const staffRoleOf = (user) => (user?.role === 'ADMIN' ? (STAFF_ROLES.includes(user.adminRole) ? user.adminRole : 'SUPER_ADMIN') : null)
export const areasOf = (user) => ROLE_AREAS[staffRoleOf(user)] || []
export const can = (user, area) => areasOf(user).includes(area)
export const isOwner = (user) => staffRoleOf(user) === 'SUPER_ADMIN'

/** Area for "/api/admin/books/summary", "/admin/books" or "books/summary". Unknown → 'system' (Super admin only). */
export function areaForPath(path) {
  const segment = String(path || '').split('?')[0].replace(/^\/?(api\/)?admin\/?/, '').split('/')[0]
  return SEGMENT_AREA[segment] || 'system'
}

/** Guard for every /api/admin request (mounted before the admin routers). */
export function staffGuard(request, response, next) {
  if (request.user?.role !== 'ADMIN') return response.status(403).json({ error: 'ADMIN_ROLE_REQUIRED' })
  const area = areaForPath(request.baseUrl + request.path)
  if (!can(request.user, area)) return response.status(403).json({ error: 'STAFF_PERMISSION_REQUIRED', message: `Your staff role (${ROLE_TEXT[staffRoleOf(request.user)].name}) can’t use this. Ask a Super admin.`, area })
  return next()
}

/** Admin pages this person may open (for hiding the rest of the menu). */
export const allowedPages = (user) => Object.entries(SEGMENT_AREA).filter(([, area]) => can(user, area)).map(([segment]) => `/admin/${segment}`)

/** Staff management (Super admin only — the guard maps /admin/staff to 'system'). */
export function createStaffRouter({ prisma, requireUser }) {
  const router = Router()
  const view = (user) => ({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, status: user.status, adminRole: staffRoleOf(user), roleName: ROLE_TEXT[staffRoleOf(user)].name, hasPassword: Boolean(user.passwordHash), createdAt: user.createdAt })
  const supers = async () => (await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true, adminRole: true, role: true } })).filter((user) => staffRoleOf(user) === 'SUPER_ADMIN')

  router.get('/admin/me', requireUser, (request, response) => {
    const role = staffRoleOf(request.user)
    return response.json({ adminRole: role, roleName: ROLE_TEXT[role].name, areas: areasOf(request.user), pages: allowedPages(request.user), owner: isOwner(request.user) })
  })

  router.get('/admin/staff', requireUser, async (_request, response) => {
    try {
      const staff = await prisma.user.findMany({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true, firstName: true, lastName: true, email: true, status: true, adminRole: true, role: true, passwordHash: true, createdAt: true } })
      return response.json({ staff: staff.map(view), roles: STAFF_ROLES.map((role) => ({ role, ...ROLE_TEXT[role], areas: ROLE_AREAS[role] })) })
    } catch { return response.status(503).json({ error: 'STAFF_UNAVAILABLE' }) }
  })

  const addSchema = z.object({ firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().max(60).optional(), email: z.string().trim().toLowerCase().email().max(160), adminRole: z.enum(STAFF_ROLES) }).strict()
  router.post('/admin/staff', requireUser, async (request, response) => {
    const parsed = addSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_STAFF', message: 'Enter a name, a valid email and a role.' })
    try {
      const existing = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, role: true } })
      // A customer, business or rider account is never turned into a staff account (that would mix their data and access).
      if (existing) return response.status(409).json({ error: 'EMAIL_IN_USE', message: existing.role === 'ADMIN' ? 'This person is already staff. Change their role in the list.' : 'That email already has a DOORSTEP customer, business or rider account. Use a separate work email for staff.' })
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email: parsed.data.email, firstName: parsed.data.firstName, lastName: parsed.data.lastName || '', role: 'ADMIN', adminRole: parsed.data.adminRole, status: 'ACTIVE' } })
        await tx.auditLog.create({ data: { actorId: request.user.id, action: 'STAFF_ADDED', entityType: 'User', entityId: created.id, metadata: { email: created.email, adminRole: parsed.data.adminRole } } })
        return created
      })
      return response.status(201).json({ staff: view(user), next: 'They set their own password with “Forgot password” on the admin sign-in page, using this email.' })
    } catch { return response.status(503).json({ error: 'STAFF_UNAVAILABLE', message: 'Couldn’t add this person. Try again.' }) }
  })

  const changeSchema = z.object({ adminRole: z.enum(STAFF_ROLES).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }).strict().refine((value) => value.adminRole || value.status, 'Nothing to change')
  router.patch('/admin/staff/:id', requireUser, async (request, response) => {
    const parsed = changeSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_STAFF' })
    try {
      const target = await prisma.user.findUnique({ where: { id: request.params.id } })
      if (!target || target.role !== 'ADMIN') return response.status(404).json({ error: 'STAFF_NOT_FOUND' })
      const before = { adminRole: staffRoleOf(target), status: target.status }
      const losesSuper = before.adminRole === 'SUPER_ADMIN' && before.status === 'ACTIVE' && ((parsed.data.adminRole && parsed.data.adminRole !== 'SUPER_ADMIN') || parsed.data.status === 'SUSPENDED')
      if (losesSuper && (await supers()).length <= 1) return response.status(409).json({ error: 'LAST_SUPER_ADMIN', message: 'DOORSTEP must always have at least one active Super admin.' })
      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.user.update({ where: { id: target.id }, data: { ...(parsed.data.adminRole ? { adminRole: parsed.data.adminRole } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}) } })
        // Suspending someone signs them out everywhere at once.
        if (parsed.data.status === 'SUSPENDED') await tx.session.deleteMany({ where: { userId: target.id } })
        await tx.auditLog.create({ data: { actorId: request.user.id, action: 'STAFF_CHANGED', entityType: 'User', entityId: target.id, metadata: { before, after: { adminRole: staffRoleOf(saved), status: saved.status } } } })
        return saved
      })
      return response.json({ staff: view(updated) })
    } catch { return response.status(503).json({ error: 'STAFF_UNAVAILABLE', message: 'Couldn’t save the change. Try again.' }) }
  })

  return router
}

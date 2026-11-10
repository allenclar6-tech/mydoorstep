// DOORSTEP staff roles: the pure rules (no Express, no zod), so browser code that shares server modules can use
// them too. The staff API and its router live in staff.js, which re-exports everything here.
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

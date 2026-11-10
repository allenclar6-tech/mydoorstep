import { Router } from 'express'
import { z } from 'zod'

import { allowedPages, areasOf, isOwner, ROLE_AREAS, ROLE_TEXT, STAFF_ROLES, staffRoleOf } from './staffRoles.js'

export * from './staffRoles.js'

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

import { Router } from 'express'
import { booksSummary, journalCsv, loadStatement, parsePeriod, payeeSummaries, statementCsv } from './bookkeeping.js'

// Books & statements. Admins: DOORSTEP's books for any period, who is owed (riders and businesses listed
// separately), each payee's statement, and the general journal for the accountant. Riders and businesses:
// their own statement only. Downloads are CSV (opens in Excel / Google Sheets). Every admin export is audited.

export function createBookRouter({ prisma, requireUser, requireAdmin }) {
  const router = Router()
  const fail = (response, error) => {
    if (error?.code && error?.status) return response.status(error.status).json({ error: error.code, message: error.message })
    console.error('[books]', error?.message)
    return response.status(503).json({ error: 'BOOKS_UNAVAILABLE', message: 'The books couldn’t be loaded. Try again.' })
  }
  const kindOf = (value) => (value === 'rider' ? 'RIDER' : value === 'business' ? 'RESTAURANT' : null)
  const sendCsv = (response, filename, csv) => {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]+/g, '-')}"`)
    response.setHeader('Cache-Control', 'no-store')
    return response.send(csv)
  }
  async function payeeName(kind, id) {
    if (kind === 'RIDER') { const rider = await prisma.rider.findUnique({ where: { id }, select: { user: { select: { firstName: true, lastName: true } } } }); return rider ? `${rider.user.firstName || ''} ${rider.user.lastName || ''}`.trim() || 'Rider' : null }
    const restaurant = await prisma.restaurant.findUnique({ where: { id }, select: { name: true } })
    return restaurant?.name || null
  }
  const shape = (statement) => ({ ...statement, lines: statement.lines.map(({ key, ...line }) => line) })

  /* ------------------------------ admin ------------------------------ */
  router.get('/admin/books/summary', requireUser, requireAdmin, async (request, response) => {
    try { return response.json(await booksSummary(prisma, parsePeriod(request.query))) } catch (error) { return fail(response, error) }
  })
  router.get('/admin/books/payees/:kind', requireUser, requireAdmin, async (request, response) => {
    const kind = kindOf(request.params.kind)
    if (!kind) return response.status(404).json({ error: 'NOT_FOUND' })
    try {
      const period = parsePeriod(request.query)
      const payees = await payeeSummaries(prisma, kind, period)
      return response.json({ period: { from: period.fromDay, to: period.toDay }, payees, owedTotalMinor: payees.reduce((sum, row) => sum + Math.max(0, row.owedNowMinor), 0) })
    } catch (error) { return fail(response, error) }
  })
  router.get('/admin/books/statement/:kind/:id', requireUser, requireAdmin, async (request, response) => {
    const kind = kindOf(request.params.kind)
    if (!kind) return response.status(404).json({ error: 'NOT_FOUND' })
    try {
      const period = parsePeriod(request.query)
      const name = await payeeName(kind, request.params.id)
      if (!name) return response.status(404).json({ error: 'PAYEE_NOT_FOUND', message: 'That rider or business was not found.' })
      const statement = await loadStatement(prisma, { kind, id: request.params.id }, period)
      if (request.query.format === 'csv') {
        await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'STATEMENT_EXPORTED', entityType: kind === 'RIDER' ? 'Rider' : 'Restaurant', entityId: request.params.id, metadata: { from: period.fromDay, to: period.toDay } } })
        return sendCsv(response, `DOORSTEP-statement-${name}-${period.fromDay}-to-${period.toDay}.csv`, statementCsv({ name, kind, period, statement }))
      }
      return response.json({ name, kind, period: { from: period.fromDay, to: period.toDay }, ...shape(statement) })
    } catch (error) { return fail(response, error) }
  })
  router.get('/admin/books/journal.csv', requireUser, requireAdmin, async (request, response) => {
    try {
      const period = parsePeriod(request.query)
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'JOURNAL_EXPORTED', entityType: 'Books', entityId: `${period.fromDay}..${period.toDay}`, metadata: {} } })
      return sendCsv(response, `DOORSTEP-journal-${period.fromDay}-to-${period.toDay}.csv`, await journalCsv(prisma, period))
    } catch (error) { return fail(response, error) }
  })

  /* --------------------- riders and businesses: their own --------------------- */
  async function me(user) {
    if (user.role === 'RIDER' && user.rider) return { kind: 'RIDER', id: user.rider.id, name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Rider' }
    if (user.role === 'RESTAURANT') {
      const membership = await prisma.restaurantUser.findFirst({ where: { userId: user.id }, select: { restaurant: { select: { id: true, name: true } } } })
      if (membership) return { kind: 'RESTAURANT', id: membership.restaurant.id, name: membership.restaurant.name }
    }
    return null
  }
  router.get('/finance/statement', requireUser, async (request, response) => {
    try {
      const who = await me(request.user)
      if (!who) return response.status(403).json({ error: 'PAYEE_ROLE_REQUIRED', message: 'Statements are for riders and businesses.' })
      const period = parsePeriod(request.query)
      const statement = await loadStatement(prisma, who, period)
      if (request.query.format === 'csv') return sendCsv(response, `DOORSTEP-statement-${period.fromDay}-to-${period.toDay}.csv`, statementCsv({ name: who.name, kind: who.kind, period, statement }))
      return response.json({ name: who.name, kind: who.kind, period: { from: period.fromDay, to: period.toDay }, ...shape(statement) })
    } catch (error) { return fail(response, error) }
  })

  return router
}

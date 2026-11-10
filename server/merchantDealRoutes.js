import { Router } from 'express'
import { z } from 'zod'
import { applyDeal, dealIsActive, dealSchema, MODE_TEXT } from './merchantDeals.js'

// Business delivery deals. Admin (Pricing manager / Super admin, enforced by the /api/admin staff guard) sets them;
// a business can read its own deal and never change it.

export function createMerchantDealRouter({ prisma, requireUser }) {
  const router = Router()
  const describe = (deal) => {
    if (!deal) return { mode: 'STANDARD', text: MODE_TEXT.STANDARD, active: false }
    const parts = [MODE_TEXT[deal.mode]]
    if (deal.mode === 'SHARED') parts.push(`business pays ${deal.merchantPercent}%`)
    if (deal.mode === 'FIXED_FEE') parts.push(`customers pay ₦${(deal.fixedFeeMinor / 100).toLocaleString('en-NG')}`)
    if (deal.merchantCapMinor != null && ['MERCHANT_PAYS', 'SHARED', 'FIXED_FEE'].includes(deal.mode)) parts.push(`business pays at most ₦${(deal.merchantCapMinor / 100).toLocaleString('en-NG')} per order`)
    if (deal.freeOverMinor != null) parts.push(`free delivery on orders of ₦${(deal.freeOverMinor / 100).toLocaleString('en-NG')}+ (paid by ${deal.freeOverPaidBy === 'MERCHANT' ? 'the business' : 'DOORSTEP'})`)
    return { ...deal, text: parts.join('; '), active: dealIsActive(deal) }
  }

  router.get('/admin/merchant-deals', requireUser, async (request, response) => {
    const q = String(request.query.q || '').trim().slice(0, 60)
    try {
      const rows = await prisma.restaurant.findMany({ where: { status: 'APPROVED', ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) }, orderBy: { name: 'asc' }, take: 200, select: { id: true, name: true, storeType: true, address: true, deliveryDeal: true, application: { select: { deliveryPreference: true } } } })
      return response.json({ businesses: rows.map((row) => ({ id: row.id, name: row.name, storeType: row.storeType, address: row.address, ownRiders: row.application?.deliveryPreference === 'OWN_RIDERS', deal: describe(row.deliveryDeal) })) })
    } catch { return response.status(503).json({ error: 'DEALS_UNAVAILABLE' }) }
  })

  router.post('/admin/merchant-deals/preview', requireUser, (request, response) => {
    const parsed = z.object({ deal: dealSchema.nullable(), feeMinor: z.number().int().min(0).max(10_000_000), subtotalMinor: z.number().int().min(0).max(100_000_000) }).strict().safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_DEAL', message: parsed.error.issues[0]?.message || 'Check the deal.' })
    return response.json({ split: applyDeal(parsed.data.feeMinor, { subtotalMinor: parsed.data.subtotalMinor, deal: parsed.data.deal ? { ...parsed.data.deal, startsAt: undefined, endsAt: undefined } : null }) })
  })

  router.put('/admin/merchant-deals/:restaurantId', requireUser, async (request, response) => {
    const parsed = z.object({ deal: dealSchema.nullable() }).strict().safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_DEAL', message: parsed.error.issues[0]?.message || 'Check the deal.' })
    const deal = parsed.data.deal?.mode === 'STANDARD' && parsed.data.deal.freeOverMinor == null ? null : parsed.data.deal
    try {
      const saved = await prisma.$transaction(async (tx) => {
        const before = await tx.restaurant.findUnique({ where: { id: request.params.restaurantId }, select: { id: true, name: true, deliveryDeal: true } })
        if (!before) return null
        const updated = await tx.restaurant.update({ where: { id: before.id }, data: { deliveryDeal: deal ?? null }, select: { id: true, name: true, deliveryDeal: true } })
        await tx.auditLog.create({ data: { actorId: request.user.id, action: 'DELIVERY_DEAL_CHANGED', entityType: 'Restaurant', entityId: before.id, metadata: { business: before.name, before: before.deliveryDeal ?? null, after: deal ?? null } } })
        return updated
      })
      if (!saved) return response.status(404).json({ error: 'BUSINESS_NOT_FOUND' })
      return response.json({ id: saved.id, name: saved.name, deal: describe(saved.deliveryDeal) })
    } catch { return response.status(503).json({ error: 'DEALS_UNAVAILABLE', message: 'The deal wasn’t saved. Try again.' }) }
  })

  // The business's own deal (read-only).
  router.get('/restaurant/delivery-deal', requireUser, async (request, response) => {
    if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
    try {
      const member = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurant: { select: { deliveryDeal: true } } } })
      if (!member) return response.status(404).json({ error: 'RESTAURANT_NOT_FOUND' })
      const deal = describe(member.restaurant.deliveryDeal)
      return response.json({ deal: { mode: deal.mode, text: deal.text, active: deal.active, startsAt: deal.startsAt || null, endsAt: deal.endsAt || null } })
    } catch { return response.status(503).json({ error: 'DEALS_UNAVAILABLE' }) }
  })

  return router
}

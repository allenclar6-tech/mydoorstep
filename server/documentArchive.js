import { Router } from 'express'
import { z } from 'zod'
import { privateDocumentSize, readPrivateDocument } from './uploadService.js'

// Document archive for admins: every ID, certificate and vehicle paper that restaurants, shops and riders have
// uploaded, kept after approval or rejection so it can be found again later (disputes, re-checks, audits).
// Files stay on the private disk; this only lists them and lets an admin download one. Each download is
// written to the activity log, because these are people's identity documents.

export const DOCUMENT_SOURCES = ['business', 'rider-application', 'rider']
const KIND_LABEL = { restaurant: 'Restaurant', grocery: 'Shop', rider: 'Rider' }
const TYPE_LABEL = {
  IDENTITY: 'ID document',
  BUSINESS_REGISTRATION: 'Business registration (CAC)',
  BUSINESS_OR_VEHICLE: 'Business or vehicle document',
}
export const documentTypeLabel = (type) => TYPE_LABEL[type] || String(type || 'Document').replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase())
const extensionOf = (key) => (String(key).match(/\.(pdf|jpg|png)$/i)?.[1] || 'pdf').toLowerCase()
const safePart = (value) => String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'document'

/** File name an admin gets when downloading, e.g. "Rider-Ada-Obi-ID-document-2026-11-03.pdf". */
export function archiveFileName(row) {
  const day = new Date(row.uploadedAt).toISOString().slice(0, 10)
  return `${safePart(KIND_LABEL[row.kind])}-${safePart(row.owner)}-${safePart(documentTypeLabel(row.type))}-${day}.${extensionOf(row.storageKey)}`
}

const personName = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()

/** Turns the three document tables into one list, newest first. */
export function archiveRows({ businessDocs = [], riderApplicationDocs = [], riderDocs = [] }) {
  const rows = [
    ...businessDocs.map((doc) => ({
      id: doc.id, source: 'business', kind: doc.application?.restaurant?.storeType === 'GROCERY' ? 'grocery' : 'restaurant',
      owner: doc.application?.restaurant?.name || doc.application?.ownerName || 'Business', contact: doc.application?.ownerName || '',
      email: doc.application?.ownerEmail || '', phone: doc.application?.ownerPhone || '',
      status: doc.application?.status || null, applicationId: doc.applicationId, type: doc.type, storageKey: doc.storageKey,
      uploadedAt: doc.createdAt, verifiedAt: doc.verifiedAt,
    })),
    ...riderApplicationDocs.map((doc) => ({
      id: doc.id, source: 'rider-application', kind: 'rider',
      owner: personName(doc.application?.rider?.user) || 'Rider', contact: '',
      email: doc.application?.rider?.user?.email || '', phone: doc.application?.rider?.user?.phone || '',
      status: doc.application?.status || null, applicationId: doc.applicationId, type: doc.type, storageKey: doc.storageKey,
      uploadedAt: doc.createdAt, verifiedAt: doc.verifiedAt,
    })),
    ...riderDocs.map((doc) => ({
      id: doc.id, source: 'rider', kind: 'rider',
      owner: personName(doc.rider?.user) || 'Rider', contact: '',
      email: doc.rider?.user?.email || '', phone: doc.rider?.user?.phone || '',
      status: doc.rider?.status || null, applicationId: null, type: doc.type, storageKey: doc.storageKey,
      uploadedAt: doc.createdAt, verifiedAt: doc.verifiedAt,
    })),
  ]
  return rows.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
}

const listSchema = z.object({
  kind: z.enum(['all', 'restaurant', 'grocery', 'rider']).default('all'),
  search: z.string().trim().max(80).default(''),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export function createDocumentArchiveRouter({ prisma, requireUser, requireAdmin }) {
  const router = Router()
  const contains = (value) => ({ contains: value, mode: 'insensitive' })

  router.get('/admin/documents', requireUser, requireAdmin, async (request, response) => {
    const parsed = listSchema.safeParse(request.query)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_DOCUMENT_FILTER' })
    const { kind, search, limit } = parsed.data
    const userMatch = search ? { OR: [{ firstName: contains(search) }, { lastName: contains(search) }, { email: contains(search) }, { phone: contains(search) }] } : null
    try {
      const wantBusiness = kind === 'all' || kind === 'restaurant' || kind === 'grocery'
      const wantRider = kind === 'all' || kind === 'rider'
      const businessWhere = {
        ...(kind === 'restaurant' || kind === 'grocery' ? { application: { is: { restaurant: { is: { storeType: kind === 'grocery' ? 'GROCERY' : 'RESTAURANT' } } } } } : {}),
        ...(search ? { AND: [{ application: { is: { OR: [{ ownerName: contains(search) }, { ownerEmail: contains(search) }, { ownerPhone: contains(search) }, { restaurant: { is: { name: contains(search) } } }] } } }] } : {}),
      }
      const [businessDocs, riderApplicationDocs, riderDocs] = await Promise.all([
        wantBusiness ? prisma.restaurantDocument.findMany({ where: businessWhere, orderBy: { createdAt: 'desc' }, take: limit, include: { application: { select: { status: true, ownerName: true, ownerEmail: true, ownerPhone: true, restaurant: { select: { name: true, storeType: true } } } } } }) : [],
        wantRider ? prisma.riderIdentityDocument.findMany({ where: userMatch ? { application: { is: { rider: { is: { user: { is: userMatch } } } } } } : {}, orderBy: { createdAt: 'desc' }, take: limit, include: { application: { select: { status: true, rider: { select: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } } } } } } }) : [],
        wantRider ? prisma.riderDocument.findMany({ where: userMatch ? { rider: { is: { user: { is: userMatch } } } } : {}, orderBy: { createdAt: 'desc' }, take: limit, include: { rider: { select: { status: true, user: { select: { firstName: true, lastName: true, email: true, phone: true } } } } } }) : [],
      ])
      const rows = archiveRows({ businessDocs, riderApplicationDocs, riderDocs }).slice(0, limit)
      // Say plainly when a file is missing from the disk, rather than failing only when someone tries to open it.
      const sizes = await Promise.all(rows.map((row) => privateDocumentSize(row.storageKey)))
      const documents = rows.map(({ storageKey, ...row }, index) => ({ ...row, typeLabel: documentTypeLabel(row.type), fileType: extensionOf(storageKey) === 'pdf' ? 'PDF' : 'Image', sizeBytes: sizes[index], stored: sizes[index] !== null, fileName: archiveFileName({ ...row, storageKey }) }))
      const [business, riderApplication, rider] = await Promise.all([prisma.restaurantDocument.count(), prisma.riderIdentityDocument.count(), prisma.riderDocument.count()])
      return response.json({ documents, totals: { all: business + riderApplication + rider, business, rider: riderApplication + rider } })
    } catch (error) {
      console.error('[documents] list_failed', JSON.stringify({ name: error?.name }))
      return response.status(503).json({ error: 'DOCUMENT_ARCHIVE_UNAVAILABLE' })
    }
  })

  router.get('/admin/documents/:source/:documentId/file', requireUser, requireAdmin, async (request, response) => {
    const { source, documentId } = request.params
    if (!DOCUMENT_SOURCES.includes(source)) return response.status(400).json({ error: 'INVALID_DOCUMENT_SOURCE' })
    try {
      const include = source === 'business'
        ? { application: { select: { status: true, ownerName: true, restaurant: { select: { name: true, storeType: true } } } } }
        : source === 'rider-application'
          ? { application: { select: { status: true, rider: { select: { user: { select: { firstName: true, lastName: true } } } } } } }
          : { rider: { select: { status: true, user: { select: { firstName: true, lastName: true } } } } }
      const model = source === 'business' ? prisma.restaurantDocument : source === 'rider-application' ? prisma.riderIdentityDocument : prisma.riderDocument
      const document = await model.findUnique({ where: { id: documentId }, include })
      if (!document) return response.status(404).json({ error: 'DOCUMENT_NOT_FOUND' })
      const [row] = archiveRows(source === 'business' ? { businessDocs: [document] } : source === 'rider-application' ? { riderApplicationDocs: [document] } : { riderDocs: [document] })
      const file = await readPrivateDocument(document.storageKey)
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'DOCUMENT_DOWNLOADED', entityType: source === 'business' ? 'RestaurantDocument' : source === 'rider-application' ? 'RiderIdentityDocument' : 'RiderDocument', entityId: document.id, metadata: { owner: row.owner, type: document.type } } }).catch(() => console.error('[documents] audit_failed'))
      const inline = request.query.view === '1'
      response.set('Cache-Control', 'private, no-store')
      response.set('X-Content-Type-Options', 'nosniff')
      response.set('Content-Type', file.mimeType)
      response.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${archiveFileName(row)}"`)
      return response.send(file.buffer)
    } catch (error) {
      if (error?.code === 'PRIVATE_DOCUMENT_NOT_FOUND') return response.status(404).json({ error: 'DOCUMENT_FILE_MISSING' })
      return response.status(error?.status || 503).json({ error: error?.code || 'DOCUMENT_ARCHIVE_UNAVAILABLE' })
    }
  })

  return router
}

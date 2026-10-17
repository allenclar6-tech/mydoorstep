import multer from 'multer'
import sharp from 'sharp'
import { readPrivateDocument, removePrivateDocument, storePrivateDocument } from './uploadService.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('image')
const menuPrefix = 'private/restaurant-media/'
export const menuMediaUrl = item => item.imageUrl?.startsWith(menuPrefix) ? `/api/media/menu/${encodeURIComponent(item.id)}` : item.imageUrl
export const publicLogoOwner = restaurant => restaurant.users?.find(member => member.user?.profileImageKey?.startsWith(`private/users/${member.userId}/`))
export const publicRestaurantImage = restaurant => publicLogoOwner(restaurant) ? `/api/media/restaurants/${encodeURIComponent(restaurant.id)}/logo` : restaurant.coverImageUrl || null

export function publicMenuItems(restaurant) {
  return [
    ...restaurant.categories.flatMap(category => category.items.map(item => ({ ...item, categoryName: category.name }))),
    ...(restaurant.menuItems || []).map(item => ({ ...item, categoryName: 'Menu' })),
  ].map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    price: Math.round(item.priceMinor / 100),
    image: menuMediaUrl(item) || null,
    category: item.categoryName,
  }))
}

export async function preparePartnerImage(file) {
  if (!file) throw Object.assign(new Error('Select an image to upload.'), { status: 400, code: 'IMAGE_REQUIRED' })
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw Object.assign(new Error('Choose a JPEG, PNG or WebP image.'), { status: 400, code: 'UNSUPPORTED_IMAGE_TYPE' })
  try {
    return await sharp(file.buffer, { limitInputPixels: 25_000_000, animated: false }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  } catch {
    throw Object.assign(new Error('This image could not be read. Choose a valid image up to 25 megapixels.'), { status: 400, code: 'INVALID_IMAGE' })
  }
}

export function registerPartnerMedia(app, { prisma, requireUser }) {
  const partner = (request, response, next) => request.user.role === 'RESTAURANT' ? next() : response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const receiveImage = (request, response, next) => upload(request, response, error => {
    if (error) return response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE_UPLOAD' })
    next()
  })
  const save = kind => async (request, response) => {
    let stored
    try {
      const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
      if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
      const previous = kind === 'menu'
        ? await prisma.menuItem.findFirst({ where: { id: request.params.itemId, restaurantId: membership.restaurantId }, select: { id: true, imageUrl: true } })
        : await prisma.user.findUnique({ where: { id: request.user.id }, select: { profileImageKey: true } })
      if (kind === 'menu' && !previous) return response.status(404).json({ error: 'MENU_ITEM_NOT_FOUND' })
      const buffer = await preparePartnerImage(request.file)
      stored = await storePrivateDocument({ buffer, mimeType: 'image/png', originalName: 'partner-image.png', keyPrefix: kind === 'logo' ? `private/users/${request.user.id}` : `${menuPrefix}${membership.restaurantId}` })
      if (kind === 'logo') {
        await prisma.user.update({ where: { id: request.user.id }, data: { profileImageKey: stored.storageKey } })
        if (previous?.profileImageKey?.startsWith(`private/users/${request.user.id}/`)) await removePrivateDocument(previous.profileImageKey).catch(() => console.error('[partner-media] old_image_cleanup_failed'))
        return response.json({ saved: true })
      }
      const result = await prisma.menuItem.updateMany({ where: { id: request.params.itemId, restaurantId: membership.restaurantId }, data: { imageUrl: stored.storageKey } })
      if (result.count !== 1) throw Object.assign(new Error('Menu item not found.'), { status: 404, code: 'MENU_ITEM_NOT_FOUND' })
      if (previous.imageUrl?.startsWith(`${menuPrefix}${membership.restaurantId}/`)) await removePrivateDocument(previous.imageUrl).catch(() => console.error('[partner-media] old_image_cleanup_failed'))
      return response.json({ imageUrl: `/api/media/menu/${encodeURIComponent(request.params.itemId)}` })
    } catch (error) {
      if (stored) await removePrivateDocument(stored.storageKey).catch(() => console.error('[partner-media] cleanup_failed'))
      if (!error.status) console.error('[partner-media] save_failed', { name: error.name })
      return response.status(error.status || 503).json({ error: error.code && error.status ? error.code : 'MEDIA_SERVICE_UNAVAILABLE' })
    }
  }
  app.post('/api/restaurant/logo', requireUser, partner, receiveImage, save('logo'))
  app.get('/api/media/restaurants/:restaurantId/logo', async (request, response) => {
    try {
      const restaurant = await prisma.restaurant.findFirst({
        where: { id: request.params.restaurantId, status: 'APPROVED' },
        select: { users: { where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true, user: { select: { profileImageKey: true } } } } },
      })
      const owner = restaurant && publicLogoOwner(restaurant)
      if (!owner) return response.status(404).json({ error: 'IMAGE_NOT_FOUND' })
      const image = await readPrivateDocument(owner.user.profileImageKey)
      response.set('Cache-Control', 'public, max-age=60')
      response.set('X-Content-Type-Options', 'nosniff')
      return response.type(image.mimeType).send(image.buffer)
    } catch (error) {
      if (error.status === 404) return response.status(404).json({ error: 'IMAGE_NOT_FOUND' })
      console.error('[partner-media] logo_read_failed', { name: error.name })
      return response.status(503).json({ error: 'MEDIA_SERVICE_UNAVAILABLE' })
    }
  })
  app.post('/api/restaurant/menu/:itemId/image', requireUser, partner, receiveImage, save('menu'))
  app.get('/api/restaurant/menu/:itemId/image', requireUser, partner, async (request, response) => {
    try {
      const item = await prisma.menuItem.findFirst({ where: { id: request.params.itemId, restaurant: { users: { some: { userId: request.user.id } } } }, select: { imageUrl: true } })
      if (!item?.imageUrl?.startsWith(menuPrefix)) return response.status(404).json({ error: 'IMAGE_NOT_FOUND' })
      const image = await readPrivateDocument(item.imageUrl)
      response.set('Cache-Control', 'private, no-store')
      return response.type(image.mimeType).send(image.buffer)
    } catch (error) {
      console.error('[partner-media] owner_read_failed', { name: error.name })
      return response.status(error.status === 404 ? 404 : 503).json({ error: error.status === 404 ? 'IMAGE_NOT_FOUND' : 'MEDIA_SERVICE_UNAVAILABLE' })
    }
  })
  app.get('/api/media/menu/:itemId', async (request, response) => {
    try {
      const item = await prisma.menuItem.findUnique({ where: { id: request.params.itemId }, include: { restaurant: { select: { status: true } } } })
      if (!item?.imageUrl?.startsWith(menuPrefix) || item.restaurant.status !== 'APPROVED' || !item.available) return response.status(404).json({ error: 'IMAGE_NOT_FOUND' })
      const image = await readPrivateDocument(item.imageUrl)
      response.set('Cache-Control', 'public, max-age=60')
      response.set('X-Content-Type-Options', 'nosniff')
      return response.type(image.mimeType).send(image.buffer)
    } catch (error) {
      if (error.status === 404) return response.status(404).json({ error: 'IMAGE_NOT_FOUND' })
      console.error('[partner-media] read_failed', { name: error.name })
      return response.status(503).json({ error: 'MEDIA_SERVICE_UNAVAILABLE' })
    }
  })
}

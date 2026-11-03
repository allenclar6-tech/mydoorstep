/* DOORSTEP service worker (public app and Admin app): shows push notifications in the phone/computer notification
   bar and opens the right page when one is tapped, puts a badge on the app icon, and shows a friendly offline
   screen when there is no internet. It never caches pages or data, so the site always loads fresh. */
const OFFLINE_CACHE = 'doorstep-offline-v2'
// public/offline.html, served by Cloudflare at /offline (asking for /offline.html redirects, and a redirected
// response can't be shown for a page load).
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))).catch(() => undefined).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name !== OFFLINE_CACHE).map((name) => caches.delete(name)))
    // Lets page loads start while the worker wakes up, so having a worker never slows the site down.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => undefined)
    await self.clients.claim()
  })())
})

// Page loads only (never API calls, images or scripts): straight to the network; the offline screen if it fails.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse
      if (preloaded) return preloaded
      return await fetch(event.request)
    } catch {
      return (await caches.match(OFFLINE_URL)) || new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
  })())
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  const title = data.title || 'DOORSTEP'
  // A dot on the app icon until the app is opened; the app then shows the exact unread count.
  if (self.navigator && 'setAppBadge' in self.navigator) self.navigator.setAppBadge().catch(() => undefined)
  const admin = String(data.link || '').startsWith('/admin')
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: admin ? '/icons/admin-192.png' : '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { link: data.link || '/' },
    vibrate: data.type === 'DELIVERY' || data.type === 'ORDER' ? [200, 100, 200] : undefined,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.link) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Admin alerts open in the Admin app, everything else in the DOORSTEP app.
    const wantAdmin = new URL(target).pathname.startsWith('/admin')
    for (const client of windows) {
      const url = new URL(client.url)
      if (url.origin === self.location.origin && url.pathname.startsWith('/admin') === wantAdmin && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) return client.navigate(target)
        return undefined
      }
    }
    return self.clients.openWindow(target)
  })())
})

const apiOrigin = 'https://mydoorstep-api.onrender.com'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.protocol === 'http:') {
      url.protocol = 'https:'
      return Response.redirect(url, 301)
    }

    if (url.pathname.startsWith('/api/')) {
      const upstreamUrl = new URL(`${url.pathname}${url.search}`, apiOrigin)
      const response = await fetch(new Request(upstreamUrl, request))
      if (url.pathname === '/api/auth/verification/request') {
        console.info('[verification-proxy]', JSON.stringify({
          mobile: /mobile|android|iphone|ipad/i.test(request.headers.get('user-agent') || ''),
          status: response.status,
        }))
      }
      return response
    }

    // Android app links: proves the DOORSTEP Android app and this website belong together (written by the
    // "Android app" GitHub workflow from the app's public signing fingerprint).
    if (url.pathname === '/.well-known/assetlinks.json') {
      const links = await env.ASSETS.fetch(new Request(new URL('/assetlinks.json', url), request))
      if (!links.ok || links.headers.get('Content-Type')?.includes('text/html')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } })
      return new Response(links.body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } })
    }

    const webResponse = await env.ASSETS.fetch(request)
    // A missing APK must be a real 404 (not the app's home page), so the download page never shows a broken button.
    if (url.pathname.startsWith('/downloads/') && (!webResponse.ok || webResponse.headers.get('Content-Type')?.includes('text/html'))) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    const headers = new Headers(webResponse.headers)
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    headers.set('Permissions-Policy', 'geolocation=(self)')
    if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate')
    // The notification service worker must always be fresh so updates reach phones quickly.
    if (url.pathname === '/sw.js') { headers.set('Cache-Control', 'no-cache'); headers.set('Service-Worker-Allowed', '/') }
    // The two app manifests (DOORSTEP and DOORSTEP Admin): always fresh so icon, name and shortcut changes reach phones.
    if (url.pathname === '/manifest.webmanifest' || url.pathname === '/admin.webmanifest') { headers.set('Cache-Control', 'no-cache'); headers.set('Content-Type', 'application/manifest+json') }
    // Android app downloads: the right file type, saved as a file, never sniffed as something else.
    if (url.pathname.startsWith('/downloads/') && url.pathname.endsWith('.apk')) {
      headers.set('Content-Type', 'application/vnd.android.package-archive')
      headers.set('Content-Disposition', `attachment; filename="${url.pathname.split('/').pop()}"`)
      headers.set('X-Content-Type-Options', 'nosniff')
    }
    // Release details for the /download page: always fresh after a new version is published.
    if (url.pathname === '/app-release.json' || url.pathname === '/admin-app-release.json') headers.set('Cache-Control', 'no-cache')
    return new Response(webResponse.body, { status: webResponse.status, statusText: webResponse.statusText, headers })
  },
}

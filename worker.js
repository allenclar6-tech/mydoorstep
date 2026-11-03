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

    const webResponse = await env.ASSETS.fetch(request)
    const headers = new Headers(webResponse.headers)
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    headers.set('Permissions-Policy', 'geolocation=(self)')
    if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate')
    // The notification service worker must always be fresh so updates reach phones quickly.
    if (url.pathname === '/sw.js') { headers.set('Cache-Control', 'no-cache'); headers.set('Service-Worker-Allowed', '/') }
    // The two app manifests (DOORSTEP and DOORSTEP Admin): always fresh so icon, name and shortcut changes reach phones.
    if (url.pathname === '/manifest.webmanifest' || url.pathname === '/admin.webmanifest') { headers.set('Cache-Control', 'no-cache'); headers.set('Content-Type', 'application/manifest+json') }
    return new Response(webResponse.body, { status: webResponse.status, statusText: webResponse.statusText, headers })
  },
}

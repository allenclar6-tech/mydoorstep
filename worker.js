const apiOrigin = 'https://mydoorstep-api.onrender.com'
const webOrigin = 'https://mydoorstep-web.onrender.com'

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

    const upstreamUrl = new URL(`${url.pathname}${url.search}`, webOrigin)
    const webResponse = await fetch(new Request(upstreamUrl, request))
    const headers = new Headers(webResponse.headers)
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    headers.set('Permissions-Policy', 'geolocation=(self)')
    if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate')
    return new Response(webResponse.body, { status: webResponse.status, statusText: webResponse.statusText, headers })
  },
}

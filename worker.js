const apiOrigin = 'https://mydoorstep-api.onrender.com'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
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

    return env.ASSETS.fetch(request)
  },
}

const apiOrigin = 'https://mydoorstep-api.onrender.com'

// Titles and summaries search engines see for key pages (plain text: no quotes or angle brackets).
const SEO_PAGES = {
  '/download': {
    title: 'Download the DOORSTEP app — food and delivery app for Delta, Edo and Port Harcourt',
    description: 'Download DOORSTEP for Android: order food, groceries and more, send packages and track your rider live in Delta State, Edo State and Port Harcourt, Nigeria. Free direct APK download and browser install.',
  },
}

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

    // One download link that never changes: /downloads/doorstep.apk always goes to the newest signed APK listed in
    // /app-release.json (written by the "Android app" workflow). Before the first build it's a plain 404.
    if (url.pathname === '/downloads/doorstep.apk') {
      const releaseResponse = await env.ASSETS.fetch(new Request(new URL('/app-release.json', url), request))
      const release = releaseResponse.ok ? await releaseResponse.json().catch(() => null) : null
      const target = release?.available && typeof release.url === 'string' ? release.url : null
      if (target && (target.startsWith('/downloads/DOORSTEP-') || target.startsWith('https://github.com/'))) {
        return new Response(null, { status: 302, headers: { Location: new URL(target, url).href, 'Cache-Control': 'no-store' } })
      }
      return new Response('The DOORSTEP Android app has not been published yet. Visit https://mydoorstep.com.co/download', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
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
    const page = new Response(webResponse.body, { status: webResponse.status, statusText: webResponse.statusText, headers })
    // Search engines: every page gets its canonical address; the download page also gets its own title and summary in
    // the HTML itself, so crawlers see them without running the app.
    if (headers.get('Content-Type')?.includes('text/html') && webResponse.ok && typeof globalThis.HTMLRewriter === 'function') {
      const canonical = `https://mydoorstep.com.co${url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '')}`
      const seo = SEO_PAGES[url.pathname.replace(/\/+$/, '') || '/']
      let rewriter = new globalThis.HTMLRewriter().on('head', { element(head) { head.append(`<link rel="canonical" href="${canonical}" />`, { html: true }) } })
      if (seo) {
        rewriter = rewriter
          .on('title', { element(title) { title.setInnerContent(seo.title) } })
          .on('meta[name="description"]', { element(meta) { meta.setAttribute('content', seo.description) } })
          .on('head', { element(head) { head.append(`<meta property="og:title" content="${seo.title}" /><meta property="og:description" content="${seo.description}" /><meta property="og:url" content="${canonical}" /><meta property="og:type" content="website" /><meta property="og:image" content="https://mydoorstep.com.co/icons/icon-512.png" />`, { html: true }) } })
      }
      return rewriter.transform(page)
    }
    return page
  },
}

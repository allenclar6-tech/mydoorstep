let loading

export function loadGoogleMaps() {
  if (globalThis.google?.maps?.importLibrary) return Promise.resolve(globalThis.google.maps)
  if (loading) return loading
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error('Google Maps needs a restricted browser key. Set VITE_GOOGLE_MAPS_API_KEY and rebuild the site.'))
  globalThis.gm_authFailure = () => {
    globalThis.dispatchEvent(new Event('doorstep-google-maps-auth-failure'))
  }
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timer = setTimeout(() => fail('Google Maps took too long to load. Check your connection and retry.'), 20000)
    const cleanup = () => {
      clearTimeout(timer)
      delete globalThis.doorstepGoogleMapsReady
    }
    const fail = (message) => {
      cleanup()
      script.remove()
      loading = undefined
      reject(new Error(message))
    }
    globalThis.doorstepGoogleMapsReady = () => { cleanup(); resolve(globalThis.google.maps) }
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=doorstepGoogleMapsReady`
    script.async = true
    script.onerror = () => fail('Google Maps could not load. Check your connection, API key and website restrictions.')
    document.head.append(script)
  })
  return loading
}

import mapboxgl from 'mapbox-gl'
import { describeStyleStatus, readPreferredStyleId, savePreferredStyleId, styleById } from './mapStyles'

// Public, browser-side token. It is not a secret: restrict it to the DOORSTEP
// website URLs and the public scopes the app needs in the Mapbox account.
export const mapToken = import.meta.env.VITE_MAP_PUBLIC_TOKEN || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || ''
export const SAPELE_CENTER = [5.6846, 5.8916]

export function describeMapError(event) {
  const status = event?.error?.status ?? event?.status
  if (status === 401) return { code: 'TOKEN_INVALID', message: 'Map configuration problem: the public Mapbox token was rejected.' }
  if (status === 403) return { code: 'TOKEN_RESTRICTED', message: 'Map configuration problem: the Mapbox token is not allowed for this website or permission.' }
  if (status === 429) return { code: 'RATE_LIMITED', message: 'The map is busy right now. Try again in a moment.' }
  if (status === 404) return { code: 'NOT_FOUND', message: 'A map resource was not found.' }
  return { code: 'NETWORK', message: 'Part of the map could not load. Check your connection.' }
}

/**
 * Wraps a Mapbox map so that app overlays (route lines, accuracy circles, etc.)
 * are independent of the basemap. Markers are DOM elements and survive style
 * changes on their own; GeoJSON sources and layers are re-added after every
 * `style.load`. Switching styles keeps the camera exactly where it was.
 */
export function createMapController(map, { onStyleChange, onStyleError } = {}) {
  const overlays = new Map() // id -> { source, layers, before }
  let currentStyleId = null
  let switching = null
  let styleReady = false
  const listeners = new Set()

  const applyOverlay = (id) => {
    const overlay = overlays.get(id)
    if (!overlay || !styleReady) return
    const existing = map.getSource(id)
    if (existing && overlay.source.type === 'geojson') existing.setData(overlay.source.data)
    else if (!existing) map.addSource(id, overlay.source)
    for (const layer of overlay.layers) {
      if (!map.getLayer(layer.id)) {
        // The Standard style supports slots; classic styles ignore unknown slots, so only pass it to Standard.
        const spec = currentStyleId === 'standard' && overlay.slot ? { ...layer, slot: overlay.slot } : layer
        map.addLayer(spec)
      } else if (layer.paint) {
        for (const [key, value] of Object.entries(layer.paint)) map.setPaintProperty(layer.id, key, value)
      }
    }
  }

  // `style.load` is the documented point where sources/layers can be (re)added.
  const restoreAll = () => { styleReady = true; for (const id of overlays.keys()) applyOverlay(id) }
  map.on('style.load', restoreAll)

  const api = {
    get styleId() { return currentStyleId },
    get ready() { return styleReady },
    setOverlay(id, source, layers, { slot = 'top' } = {}) {
      overlays.set(id, { source, layers, slot })
      applyOverlay(id)
    },
    updateOverlayData(id, data) {
      const overlay = overlays.get(id)
      if (!overlay) return
      overlay.source = { ...overlay.source, data }
      const source = map.getSource(id)
      if (source) source.setData(data)
    },
    removeOverlay(id) {
      const overlay = overlays.get(id)
      overlays.delete(id)
      if (!overlay) return
      for (const layer of [...overlay.layers].reverse()) if (map.getLayer(layer.id)) map.removeLayer(layer.id)
      if (map.getSource(id)) map.removeSource(id)
    },
    hasOverlay(id) { return overlays.has(id) },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    /** Resolves to { ok: true } or { ok: false, message } after falling back to the previous style. */
    switchStyle(styleId, { remember = true } = {}) {
      const style = styleById(styleId)
      if (style.id === currentStyleId && !switching) return Promise.resolve({ ok: true })
      const previous = currentStyleId
      const camera = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
      switching = new Promise((resolve) => {
        let settled = false
        const finish = (result) => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          map.off('style.load', onLoad)
          map.off('error', onError)
          switching = null
          resolve(result)
        }
        const onLoad = () => {
          map.jumpTo(camera)
          if (remember) savePreferredStyleId(style.id)
          listeners.forEach((listener) => listener(style.id))
          onStyleChange?.(style.id)
          finish({ ok: true })
        }
        const onError = (event) => {
          // Only failures of the style document itself abort the switch; a single missing tile does not.
          const url = event?.error?.url || ''
          const isStyleRequest = /\/styles\/v1\//.test(url) || (!styleReady && Boolean(event?.error?.status))
          if (!isStyleRequest) return
          const message = describeStyleStatus(event.error.status ?? 0)
          onStyleError?.(style.id, message)
          if (previous && previous !== style.id) {
            currentStyleId = previous
            styleReady = false
            map.once('style.load', () => map.jumpTo(camera))
            map.setStyle(styleById(previous).url, { diff: false })
          }
          finish({ ok: false, message })
        }
        const timer = window.setTimeout(() => {
          onStyleError?.(style.id, 'The style took too long to load.')
          finish({ ok: false, message: 'The style took too long to load. Your previous map style is still in use.' })
        }, 15_000)
        map.on('style.load', onLoad)
        map.on('error', onError)
        currentStyleId = style.id
        styleReady = false
        map.setStyle(style.url, { diff: false })
      })
      return switching
    },
    markInitialStyle(styleId) { currentStyleId = styleId },
    destroy() { map.off('style.load', restoreAll); overlays.clear(); listeners.clear() },
  }
  return api
}

/** Creates a map using the viewer's remembered basemap (Standard by default). */
export function createDoorstepMap(container, { center = SAPELE_CENTER, zoom = 13, styleId, interactive = true } = {}) {
  if (!mapToken) return null
  mapboxgl.accessToken = mapToken
  const initialStyle = styleById(styleId || readPreferredStyleId())
  const map = new mapboxgl.Map({ container, style: initialStyle.url, center, zoom, pitch: 0, bearing: 0, interactive, cooperativeGestures: false })
  const controller = createMapController(map)
  controller.markInitialStyle(initialStyle.id)
  // If the remembered style fails on first load, fall back to Streets once.
  let fellBack = false
  map.on('error', (event) => {
    if (fellBack || map.isStyleLoaded() || initialStyle.id === 'streets') return
    const status = event?.error?.status
    if (status === 404 || status === 403) {
      fellBack = true
      map.setStyle(styleById('streets').url, { diff: false })
      controller.markInitialStyle('streets')
    }
  })
  return { map, controller, initialStyleId: initialStyle.id }
}

export function lineOverlay(id, { color = '#007c63', width = 5, casing = '#ffffff', opacity = 0.95, dashed = false } = {}) {
  return [
    { id: `${id}-casing`, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': casing, 'line-width': width + 3, 'line-opacity': 0.9 } },
    { id: `${id}-line`, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': width, 'line-opacity': opacity, ...(dashed ? { 'line-dasharray': [1.2, 1.4] } : {}) } },
  ]
}

export function featureOf(geometry, properties = {}) { return { type: 'Feature', properties, geometry } }
export const emptyCollection = { type: 'FeatureCollection', features: [] }

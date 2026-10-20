import { useEffect, useRef, useState } from 'react'
import { createDoorstepMap, emptyCollection, featureOf, loadMapToken } from '../map/mapCore'
import { LayersControl } from '../map/LayersControl'

export const STATUS_COLORS = { verified: '#007c63', needs_review: '#d97706', needs_local_verification: '#7c3aed', pending: '#6b7280', rejected: '#b3261e' }

/**
 * Directory map: every location pin coloured by verification status, the selected location's coverage, and
 * two editing modes — `pin` (tap to move the pin) and `draw` (tap to add boundary corners). Overlays are kept
 * through basemap style changes by the shared map controller, and the camera never jumps on style switch.
 */
export function LocationsMap({ locations, selectedId, onSelect, mode = 'view', draftPin, onPin, draftRing, onRingPoint, coverage, height = 360 }) {
  const container = useRef(null)
  const state = useRef({})
  const [error, setError] = useState('')
  const [controller, setController] = useState(null)
  const handlers = useRef({})
  handlers.current = { onSelect, onPin, onRingPoint, mode }

  useEffect(() => {
    let cancelled = false
    loadMapToken().then(() => {
      if (cancelled || !container.current) return
      const created = createDoorstepMap(container.current, { zoom: 11 })
      if (!created) { setError('The map isn’t configured (missing public Mapbox token).'); return }
      const { map, controller: mapController } = created
      state.current = { map, controller: mapController }
      map.on('error', (event) => { if (event?.error?.status === 401 || event?.error?.status === 403) setError('The map token was rejected for this website.') })
      map.on('click', (event) => {
        const { mode: current, onPin: setPin, onRingPoint: addPoint, onSelect: select } = handlers.current
        const point = { latitude: Number(event.lngLat.lat.toFixed(7)), longitude: Number(event.lngLat.lng.toFixed(7)) }
        if (current === 'pin') { setPin?.(point); return }
        if (current === 'draw') { addPoint?.(point); return }
        const hit = map.getLayer('loc-pins-circle') ? map.queryRenderedFeatures(event.point, { layers: ['loc-pins-circle'] })[0] : null
        if (hit) select?.(hit.properties.id)
      })
      mapController.setOverlay('loc-coverage', { type: 'geojson', data: emptyCollection }, [
        { id: 'loc-coverage-fill', type: 'fill', source: 'loc-coverage', paint: { 'fill-color': '#ffc244', 'fill-opacity': 0.22 } },
        { id: 'loc-coverage-line', type: 'line', source: 'loc-coverage', paint: { 'line-color': '#b7791f', 'line-width': 2, 'line-dasharray': [2, 1] } },
      ])
      mapController.setOverlay('loc-draft', { type: 'geojson', data: emptyCollection }, [
        { id: 'loc-draft-line', type: 'line', source: 'loc-draft', paint: { 'line-color': '#123d2d', 'line-width': 3 } },
        { id: 'loc-draft-points', type: 'circle', source: 'loc-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#123d2d', 'circle-stroke-width': 2 } },
      ])
      mapController.setOverlay('loc-pins', { type: 'geojson', data: emptyCollection }, [
        { id: 'loc-pins-circle', type: 'circle', source: 'loc-pins', paint: { 'circle-radius': ['case', ['get', 'selected'], 9, 6], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } },
        { id: 'loc-pins-label', type: 'symbol', source: 'loc-pins', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#14231d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
      ])
      setController(mapController)
    }).catch(() => setError('The map could not load.'))
    return () => { cancelled = true; state.current.map?.remove(); state.current = {} }
  }, [])

  useEffect(() => {
    if (!controller) return
    const features = locations.filter((row) => row.latitude != null && row.longitude != null).map((row) => featureOf({ type: 'Point', coordinates: [row.id === selectedId && draftPin ? draftPin.longitude : row.longitude, row.id === selectedId && draftPin ? draftPin.latitude : row.latitude] }, { id: row.id, name: row.name, color: STATUS_COLORS[row.verificationStatus || row.status] || '#6b7280', selected: row.id === selectedId }))
    if (draftPin && !locations.some((row) => row.id === selectedId && row.latitude != null)) features.push(featureOf({ type: 'Point', coordinates: [draftPin.longitude, draftPin.latitude] }, { id: selectedId || 'draft', name: 'New pin', color: '#123d2d', selected: true }))
    controller.updateOverlayData('loc-pins', { type: 'FeatureCollection', features })
  }, [controller, locations, selectedId, draftPin])

  useEffect(() => {
    if (!controller) return
    const features = []
    if (coverage?.coverageMethod === 'POLYGON' && coverage.boundaryGeometry) features.push(featureOf(coverage.boundaryGeometry))
    if (coverage?.coverageMethod === 'RADIUS' && coverage.coverageRadiusMeters && coverage.latitude != null) features.push(featureOf(circlePolygon(coverage, coverage.coverageRadiusMeters)))
    controller.updateOverlayData('loc-coverage', { type: 'FeatureCollection', features })
  }, [controller, coverage])

  useEffect(() => {
    if (!controller) return
    const ring = draftRing || []
    const features = ring.map((point) => featureOf({ type: 'Point', coordinates: [point.longitude, point.latitude] }))
    if (ring.length > 1) features.push(featureOf({ type: 'LineString', coordinates: [...ring, ...(ring.length > 2 ? [ring[0]] : [])].map((point) => [point.longitude, point.latitude]) }))
    controller.updateOverlayData('loc-draft', { type: 'FeatureCollection', features })
  }, [controller, draftRing])

  useEffect(() => {
    const { map } = state.current
    const row = locations.find((entry) => entry.id === selectedId)
    if (map && row?.latitude != null) map.easeTo({ center: [row.longitude, row.latitude], zoom: Math.max(map.getZoom(), 13), duration: 600 })
  }, [selectedId])

  return <div className="lm-wrap" style={{ height }}>
    <div ref={container} className="lm-map" aria-label="Sapele locations map" />
    {controller && <LayersControl controller={controller} className="lm-layers" />}
    {mode !== 'view' && <div className="lm-mode">{mode === 'pin' ? 'Tap the map to place the pin' : 'Tap the map to add boundary corners'}</div>}
    {error && <div className="lm-error" role="alert">{error}</div>}
  </div>
}

export function circlePolygon(centre, radiusMeters, steps = 48) {
  const coordinates = []
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI
    const dLat = (radiusMeters / 6_371_000) * Math.cos(angle) * 180 / Math.PI
    const dLng = (radiusMeters / (6_371_000 * Math.cos(centre.latitude * Math.PI / 180))) * Math.sin(angle) * 180 / Math.PI
    coordinates.push([centre.longitude + dLng, centre.latitude + dLat])
  }
  return { type: 'Polygon', coordinates: [coordinates] }
}

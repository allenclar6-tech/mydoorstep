import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { createDoorstepMap, describeMapError, featureOf, lineOverlay, mapToken as currentMapToken, SAPELE_CENTER, useMapToken } from './map/mapCore'
import { LayersControl } from './map/LayersControl'
import { fetchDrivingRoutes, formatDuration } from './map/addressSearch'

const STALE_AFTER_MS = 2 * 60 * 1000

function markerElement(className, label) {
  const element = document.createElement('div')
  element.className = `tracking-marker ${className}`
  element.setAttribute('role', 'img')
  element.setAttribute('aria-label', label)
  return element
}

async function geocodeAddress(address) {
  const mapToken = currentMapToken
  if (!address || !mapToken) return null
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(`${address}, Nigeria`)}&country=ng&limit=1&access_token=${encodeURIComponent(mapToken)}`)
  if (!response.ok) throw new Error(`Address lookup failed with ${response.status}`)
  const feature = (await response.json()).features?.[0]
  return Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : null
}

const toLngLat = (point) => point?.latitude != null && point?.longitude != null ? [Number(point.longitude), Number(point.latitude)] : null
const distanceMeters = (a, b) => {
  const radians = (value) => value * Math.PI / 180
  const dLat = radians(b[1] - a[1]); const dLng = radians(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

function ageLabel(recordedAt, now) {
  if (!recordedAt) return ''
  const seconds = Math.max(0, Math.round((now - new Date(recordedAt).getTime()) / 1000))
  if (seconds < 60) return 'updated just now'
  const minutes = Math.round(seconds / 60)
  return `last update ${minutes} min ago`
}

/**
 * Live delivery map for both food orders and parcel bookings. Markers are
 * updated in place (the map is never recreated), and route lines survive
 * basemap style changes via the map controller.
 */
export function DeliveryTrackingMap({ tracking, connection }) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const controllerRef = useRef(null)
  const markers = useRef({})
  const lastEtaRef = useRef({ at: 0, from: null })
  const [controller, setController] = useState(null)
  const { token: mapToken, resolved: tokenResolved } = useMapToken()
  const [mapState, setMapState] = useState('loading')
  const [routeInfo, setRouteInfo] = useState('')
  const [riderEta, setRiderEta] = useState(null)
  const [mapError, setMapError] = useState('')
  useEffect(() => { if (!mapToken && tokenResolved) { setMapState('unavailable'); setMapError('The map is not set up yet. Your delivery status updates still work.') } }, [mapToken, tokenResolved])
  const [now, setNow] = useState(Date.now())

  const isParcel = tracking?.kind === 'parcel' || Boolean(tracking?.parcel)
  const pickup = isParcel ? toLngLat(tracking.parcel.pickup) : null
  const destination = isParcel ? toLngLat(tracking.parcel.destination) : toLngLat(tracking?.order?.destination)
  const rider = toLngLat(tracking?.delivery?.location)
  const recordedAt = tracking?.delivery?.location?.recordedAt
  const active = Boolean(tracking?.delivery?.active)
  const deliveryStatus = tracking?.delivery?.status
  const stale = recordedAt ? now - new Date(recordedAt).getTime() > STALE_AFTER_MS : false
  const heading = ['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT'].includes(deliveryStatus) ? 'pickup' : 'destination'

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer) }, [])

  useEffect(() => {
    if (!mapToken || !mapElement.current || mapRef.current) return undefined
    if (!mapboxgl.supported()) { setMapState('unavailable'); setMapError('This browser cannot display the map. Your delivery status updates still work.'); return undefined }
    const created = createDoorstepMap(mapElement.current, { center: destination || SAPELE_CENTER, zoom: destination ? 14 : 12 })
    const { map, controller: mapController } = created
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    controllerRef.current = mapController
    map.on('load', () => { setMapState('ready'); setController(mapController) })
    map.on('error', (event) => {
      const problem = describeMapError(event)
      if (!map.loaded() || problem.code === 'TOKEN_INVALID' || problem.code === 'TOKEN_RESTRICTED') {
        setMapState('unavailable')
        setMapError(`${problem.message} Your delivery status updates still work.`)
      }
    })
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(mapElement.current)
    return () => {
      observer.disconnect()
      Object.values(markers.current).forEach((mapMarker) => mapMarker.remove())
      markers.current = {}
      mapController.destroy()
      map.remove()
      mapRef.current = null
      controllerRef.current = null
    }
  }, [mapToken])

  const setMarker = (key, position, className, label) => {
    const map = mapRef.current
    if (!map) return
    if (!position) { markers.current[key]?.remove(); delete markers.current[key]; return }
    if (!markers.current[key]) markers.current[key] = new mapboxgl.Marker({ element: markerElement(className, label) }).setLngLat(position).addTo(map)
    else markers.current[key].setLngLat(position)
  }

  useEffect(() => { setMarker('destination', destination, 'tracking-marker-customer', 'Delivery destination') }, [destination?.[0], destination?.[1], mapState])
  useEffect(() => { if (isParcel) setMarker('pickup', pickup, 'tracking-marker-restaurant', 'Pickup point') }, [pickup?.[0], pickup?.[1], mapState])
  useEffect(() => {
    setMarker('rider', active ? rider : null, `tracking-marker-rider${stale ? ' is-stale' : ''}`, stale ? 'Assigned rider (location may be out of date)' : 'Assigned rider')
    markers.current.rider?.getElement().classList.toggle('is-stale', stale)
  }, [rider?.[0], rider?.[1], active, stale, mapState])

  // Delivery route: stored server route for parcels; restaurant -> customer preview for food orders.
  useEffect(() => {
    const map = mapRef.current
    const mapController = controllerRef.current
    if (!map || !mapController || mapState !== 'ready' || !destination) return undefined
    let cancelled = false
    const draw = (geometry, origin) => {
      mapController.setOverlay('delivery-tracking-route', { type: 'geojson', data: featureOf(geometry) }, lineOverlay('delivery-tracking-route', { color: '#007c63', width: 5 }), { slot: 'middle' })
      const bounds = new mapboxgl.LngLatBounds(origin, destination)
      geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate))
      if (rider) bounds.extend(rider)
      map.fitBounds(bounds, { padding: 52, maxZoom: 15, duration: 0 })
    }
    if (isParcel) {
      const geometry = tracking.parcel.route?.geometry
      if (geometry?.type === 'LineString' && pickup) {
        draw(geometry, pickup)
        setRouteInfo(`${(tracking.parcel.route.distanceMeters / 1000).toFixed(1)} km delivery route`)
      }
      return undefined
    }
    if (!tracking?.order?.restaurant?.address) return undefined
    geocodeAddress(tracking.order.restaurant.address).then(async (restaurant) => {
      if (cancelled) return
      if (!restaurant) { setMapError('The restaurant location could not be placed on the map. The destination and rider remain visible.'); return }
      setMarker('restaurant', restaurant, 'tracking-marker-restaurant', 'Restaurant')
      const [route] = await fetchDrivingRoutes({ longitude: restaurant[0], latitude: restaurant[1] }, { longitude: destination[0], latitude: destination[1] }, { alternatives: false })
      if (cancelled || !route) return
      draw(route.geometry, restaurant)
      setRouteInfo(`About ${formatDuration(route.durationSeconds)} from restaurant to door (estimate)`)
    }).catch(() => !cancelled && setMapError('Route estimate is unavailable. The live delivery point remains available.'))
    return () => { cancelled = true }
  }, [isParcel, tracking?.parcel?.id, tracking?.order?.restaurant?.address, destination?.[0], destination?.[1], mapState])

  // Rider ETA to the next stop: refreshed at most every 60 s or when the rider moves 150 m.
  useEffect(() => {
    if (!active || !rider || stale) { setRiderEta(null); return undefined }
    const target = heading === 'pickup' && pickup ? pickup : destination
    if (!target) return undefined
    const last = lastEtaRef.current
    if (last.from && Date.now() - last.at < 60_000 && distanceMeters(last.from, rider) < 150) return undefined
    lastEtaRef.current = { at: Date.now(), from: rider }
    const controller = new AbortController()
    fetchDrivingRoutes({ longitude: rider[0], latitude: rider[1] }, { longitude: target[0], latitude: target[1] }, { alternatives: false, signal: controller.signal })
      .then(([route]) => setRiderEta({ seconds: route.durationSeconds, to: heading }))
      .catch(() => setRiderEta(null))
    return () => controller.abort()
  }, [rider?.[0], rider?.[1], active, stale, heading])

  const recenter = () => {
    const map = mapRef.current
    if (!map) return
    const focus = rider && active ? rider : destination || pickup
    if (focus) map.flyTo({ center: focus, zoom: Math.max(map.getZoom(), 14), duration: 550, essential: true })
  }

  const headline = !active
    ? (deliveryStatus === 'DELIVERED' ? 'Delivered. Live tracking has ended.' : deliveryStatus === 'CANCELLED' ? 'Cancelled. Live tracking has ended.' : 'Live tracking starts when a rider accepts.')
    : !rider ? 'Waiting for your rider to share their location'
      : stale ? `Rider location is out of date (${ageLabel(recordedAt, now)}). It will update when their signal returns.`
        : riderEta ? `Rider about ${formatDuration(riderEta.seconds)} from the ${riderEta.to} (estimate) · ${ageLabel(recordedAt, now)}`
          : `Rider location ${ageLabel(recordedAt, now)}`

  return <section className="delivery-tracking-map">
    <div className="delivery-tracking-map-head"><div><span className="section-kicker">LIVE DELIVERY VIEW</span><strong>{headline}</strong>{routeInfo && <small>{routeInfo}</small>}</div><span className={`tracking-connection ${connection}`}>{!active ? 'Ended' : connection === 'live' ? 'Live signal' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}</span></div>
    <div className="delivery-tracking-stage">
      <div className="delivery-tracking-map-canvas" ref={mapElement} aria-label="Live delivery tracking map" />
      {mapState === 'ready' && <LayersControl controller={controller} />}
      {mapState !== 'ready' && <div className="tracking-map-overlay">{mapState === 'loading' ? 'Preparing your live delivery view…' : mapError}</div>}
      {mapState === 'ready' && <button className="tracking-recenter" type="button" onClick={recenter} disabled={!destination && !pickup}>Focus delivery</button>}
    </div>
    {mapError && mapState === 'ready' && <p className="tracking-map-notice">{mapError}</p>}
  </section>
}

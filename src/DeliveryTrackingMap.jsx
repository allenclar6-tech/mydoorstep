import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

function marker(className, label) {
  const element = document.createElement('div')
  element.className = `tracking-marker ${className}`
  element.setAttribute('aria-label', label)
  return element
}

async function geocodeAddress(address) {
  if (!address || !token) return null
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(`${address}, Nigeria`)}&country=ng&limit=1&access_token=${encodeURIComponent(token)}`)
  if (!response.ok) throw new Error(`Address lookup failed with ${response.status}`)
  const feature = (await response.json()).features?.[0]
  return Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : null
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds)) return 'Route ETA unavailable'
  return `About ${Math.max(1, Math.ceil(seconds / 60))} min away`
}

export function DeliveryTrackingMap({ tracking, connection }) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markers = useRef({})
  const [mapState, setMapState] = useState(token ? 'loading' : 'unavailable')
  const [routeInfo, setRouteInfo] = useState('')
  const [mapError, setMapError] = useState('')

  const destination = tracking?.order?.destination?.latitude != null && tracking?.order?.destination?.longitude != null
    ? [Number(tracking.order.destination.longitude), Number(tracking.order.destination.latitude)]
    : null
  const rider = tracking?.delivery?.location?.latitude != null && tracking?.delivery?.location?.longitude != null
    ? [Number(tracking.delivery.location.longitude), Number(tracking.delivery.location.latitude)]
    : null

  useEffect(() => {
    if (!token || !mapElement.current || mapRef.current || !mapboxgl.supported()) {
      if (!mapboxgl.supported()) setMapState('unavailable')
      return undefined
    }
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({ container: mapElement.current, style: 'mapbox://styles/mapbox/streets-v12', center: destination || [5.6846, 5.8916], zoom: destination ? 14 : 12 })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    mapRef.current = map
    map.on('load', () => setMapState('ready'))
    map.on('error', () => {
      setMapState('unavailable')
      setMapError('Live map is unavailable right now. Your order status is still up to date.')
    })
    return () => {
      Object.values(markers.current).forEach((mapMarker) => mapMarker.remove())
      map.remove()
      mapRef.current = null
      markers.current = {}
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !destination) return
    if (!markers.current.destination) markers.current.destination = new mapboxgl.Marker({ element: marker('tracking-marker-customer', 'Delivery destination') }).setLngLat(destination).addTo(map)
    else markers.current.destination.setLngLat(destination)
  }, [destination?.[0], destination?.[1]])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !rider) return
    if (!markers.current.rider) markers.current.rider = new mapboxgl.Marker({ element: marker('tracking-marker-rider', 'Assigned rider') }).setLngLat(rider).addTo(map)
    else markers.current.rider.setLngLat(rider)
  }, [rider?.[0], rider?.[1]])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !tracking?.order?.restaurant?.address || !destination) return
    let cancelled = false
    geocodeAddress(tracking.order.restaurant.address).then(async (restaurant) => {
      if (cancelled || !restaurant) {
        if (!cancelled) setMapError('Restaurant location is unavailable for this order. The destination and rider remain visible.')
        return
      }
      if (!markers.current.restaurant) markers.current.restaurant = new mapboxgl.Marker({ element: marker('tracking-marker-restaurant', 'Restaurant') }).setLngLat(restaurant).addTo(map)
      else markers.current.restaurant.setLngLat(restaurant)
      const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${restaurant.join(',')};${destination.join(',')}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`)
      if (!response.ok) throw new Error(`Route request failed with ${response.status}`)
      const route = (await response.json()).routes?.[0]
      if (!route?.geometry || cancelled) return
      const data = { type: 'Feature', properties: {}, geometry: route.geometry }
      const source = map.getSource('delivery-tracking-route')
      if (source) source.setData(data)
      else {
        map.addSource('delivery-tracking-route', { type: 'geojson', data })
        map.addLayer({ id: 'delivery-tracking-route-casing', type: 'line', source: 'delivery-tracking-route', paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': .9 } })
        map.addLayer({ id: 'delivery-tracking-route-line', type: 'line', source: 'delivery-tracking-route', paint: { 'line-color': '#007c63', 'line-width': 5, 'line-opacity': .95 } })
      }
      setRouteInfo(formatEta(route.duration))
      const bounds = new mapboxgl.LngLatBounds(restaurant, destination)
      if (rider) bounds.extend(rider)
      map.fitBounds(bounds, { padding: 52, maxZoom: 15, duration: 0 })
    }).catch(() => !cancelled && setMapError('Route estimate is unavailable. The live delivery point remains available.'))
    return () => { cancelled = true }
  }, [tracking?.order?.restaurant?.address, destination?.[0], destination?.[1]])

  const recenter = () => {
    const map = mapRef.current
    if (!map || !destination) return
    if (rider) map.flyTo({ center: rider, zoom: Math.max(map.getZoom(), 14), duration: 550, essential: true })
    else map.flyTo({ center: destination, zoom: Math.max(map.getZoom(), 14), duration: 550, essential: true })
  }

  return <section className="delivery-tracking-map">
    <div className="delivery-tracking-map-head"><div><span className="section-kicker">LIVE DELIVERY VIEW</span><strong>{routeInfo || (rider ? 'Your rider is sharing a verified location' : 'Waiting for your rider to start sharing location')}</strong></div><span className={`tracking-connection ${connection}`}>{connection === 'live' ? 'Live signal' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}</span></div>
    <div className="delivery-tracking-map-canvas" ref={mapElement} aria-label="Live delivery tracking map" />
    {mapState !== 'ready' && <div className="tracking-map-overlay">{mapState === 'loading' ? 'Preparing your live delivery view…' : 'Map view unavailable. Your secure delivery updates remain available.'}</div>}
    <button className="tracking-recenter" type="button" onClick={recenter} disabled={!destination}>Focus delivery</button>
    {mapError && <p className="tracking-map-notice">{mapError}</p>}
  </section>
}

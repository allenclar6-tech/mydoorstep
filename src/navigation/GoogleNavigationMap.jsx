import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from './googleMaps'
import { routeColors } from './navigation'

const latLng = (point) => ({ lat: point.latitude, lng: point.longitude })

export default function GoogleNavigationMap({ origin, stops, routes, selectedRoute, position, following, overviewKey, onSelectRoute, onPick, onReady }) {
  const container = useRef(null)
  const mapRef = useRef(null)
  const googleRef = useRef(null)
  const pickRef = useRef(onPick)
  const selectRef = useRef(onSelectRoute)
  const readyRef = useRef(onReady)
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  pickRef.current = onPick
  selectRef.current = onSelectRoute
  readyRef.current = onReady

  useEffect(() => {
    let disposed = false
    let clickListener
    const authFailure = () => {
      setError('Google Maps rejected this browser key. Check website restrictions, Maps JavaScript API access and billing.')
      setState('error')
      readyRef.current?.(false)
    }
    window.addEventListener('doorstep-google-maps-auth-failure', authFailure)
    setState('loading')
    loadGoogleMaps().then(async (maps) => {
      const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')])
      if (disposed) return
      googleRef.current = { maps, AdvancedMarkerElement }
      const map = new Map(container.current, {
        center: { lat: 5.8916, lng: 5.6846 },
        zoom: 14,
        mapId: import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID',
        renderingType: maps.RenderingType.VECTOR,
        headingInteractionEnabled: true,
        tiltInteractionEnabled: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        rotateControl: true,
        gestureHandling: 'greedy',
        clickableIcons: true,
      })
      mapRef.current = map
      clickListener = map.addListener('click', (event) => {
        if (!event.latLng) return
        const picked = pickRef.current?.({ latitude: event.latLng.lat(), longitude: event.latLng.lng(), label: 'Pinned map location', ...(event.placeId ? { placeId: event.placeId } : {}) })
        if (picked) event.stop?.()
      })
      setState('ready')
      readyRef.current?.(true)
    }).catch((failure) => {
      if (!disposed) { setError(failure.message); setState('error'); readyRef.current?.(false) }
    })
    return () => {
      disposed = true
      clickListener?.remove()
      window.removeEventListener('doorstep-google-maps-auth-failure', authFailure)
      mapRef.current = null
      readyRef.current?.(false)
    }
  }, [attempt])

  useEffect(() => {
    if (state !== 'ready' || !mapRef.current) return undefined
    const { maps } = googleRef.current
    const lines = routes.map((route, index) => {
      const selected = index === selectedRoute
      const line = new maps.Polyline({
        map: mapRef.current,
        path: route.path.map(latLng),
        strokeColor: routeColors[index],
        strokeWeight: selected ? 7 : 5,
        strokeOpacity: selected ? 1 : 0.65,
        zIndex: selected ? 20 : 10,
      })
      const listener = line.addListener('click', () => selectRef.current(index))
      return { line, listener }
    })
    return () => lines.forEach(({ line, listener }) => { listener.remove(); line.setMap(null) })
  }, [routes, selectedRoute, state])

  useEffect(() => {
    if (state !== 'ready' || !mapRef.current) return undefined
    const { AdvancedMarkerElement } = googleRef.current
    const points = [...(origin ? [{ point: origin, label: 'Start', className: 'nav-origin-marker' }] : []),
      ...stops.filter(Boolean).map((point, index, list) => ({
        point, label: index === list.length - 1 ? 'Destination' : `Stop ${index + 1}`,
        className: index === list.length - 1 ? 'nav-destination-marker' : 'nav-stop-marker',
        number: index + 1,
      }))]
    const markers = points.map(({ point, label, className, number }) => {
      const element = document.createElement('span')
      element.className = className
      if (className === 'nav-stop-marker') element.textContent = String(number)
      return new AdvancedMarkerElement({ map: mapRef.current, position: latLng(point), content: element, title: `${label}: ${point.label}`, zIndex: 30 })
    })
    return () => markers.forEach((marker) => { marker.map = null })
  }, [origin, stops, state])

  useEffect(() => {
    if (state !== 'ready' || !mapRef.current || !position) return undefined
    const { maps, AdvancedMarkerElement } = googleRef.current
    const dot = document.createElement('span')
    dot.className = 'nav-gps-dot'
    if (position.heading != null) {
      const heading = document.createElement('span')
      heading.className = 'nav-heading'
      heading.style.transform = `rotate(${position.heading}deg)`
      dot.append(heading)
    }
    const marker = new AdvancedMarkerElement({ map: mapRef.current, position: latLng(position), content: dot, title: `Your GPS location, accuracy ${Math.round(position.accuracy)} metres`, zIndex: 50 })
    const circle = new maps.Circle({
      map: mapRef.current, center: latLng(position), radius: position.accuracy,
      fillColor: '#4285f4', fillOpacity: 0.1, strokeColor: '#4285f4', strokeOpacity: 0.3, strokeWeight: 1, clickable: false,
    })
    if (following) {
      mapRef.current.moveCamera({ center: latLng(position), zoom: 18, ...(position.heading != null ? { heading: position.heading } : {}) })
    }
    return () => { marker.map = null; circle.setMap(null) }
  }, [position, following, state])

  useEffect(() => {
    if (state !== 'ready' || !mapRef.current || following) return
    const points = routes[selectedRoute]?.path || [...(origin ? [origin] : []), ...stops.filter(Boolean)]
    if (!points.length) return
    const fit = () => {
      const bounds = new googleRef.current.maps.LatLngBounds()
      points.forEach((point) => bounds.extend(latLng(point)))
      if (points.length === 1) mapRef.current.moveCamera({ center: latLng(points[0]), zoom: 16 })
      else mapRef.current.fitBounds(bounds, 65)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [routes, selectedRoute, origin, stops, overviewKey, following, state])

  return <div className="nav-map-stage">
    <div ref={container} className="nav-google-map" aria-label="Interactive Google navigation map" />
    {state !== 'ready' && <div className="nav-map-empty" role={state === 'error' ? 'alert' : 'status'}>
      <span className="nav-empty-orbit" aria-hidden="true">D</span>
      <h2>{state === 'loading' ? 'Opening your map' : 'Map unavailable'}</h2>
      <p>{state === 'loading' ? 'Loading real roads, places and directions from Google Maps.' : error}</p>
      {state === 'error' && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry map</button>}
    </div>}
  </div>
}

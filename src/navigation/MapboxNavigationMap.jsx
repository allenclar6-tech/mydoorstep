import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { routeColors } from './navigation'
import { createMapController, useMapToken } from '../map/mapCore'
import { readPreferredStyleId, styleById } from '../map/mapStyles'
import { LayersControl } from '../map/LayersControl'

const coordinates = (point) => [point.longitude, point.latitude]

export default function MapboxNavigationMap({ origin, stops, routes, selectedRoute, position, following, overviewKey, onSelectRoute, onPick, onReady }) {
  const container = useRef(null)
  const mapRef = useRef(null)
  const callbacks = useRef({ onSelectRoute, onPick, onReady })
  callbacks.current = { onSelectRoute, onPick, onReady }
  const { token, resolved: tokenResolved } = useMapToken()
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [controller, setController] = useState(null)
  // Bumped after every basemap change so route and GPS layers are re-added to the new style.
  const [styleEpoch, setStyleEpoch] = useState(0)

  useEffect(() => {
    setState('loading')
    if (!token && !tokenResolved) return undefined
    if (!token || !mapboxgl.supported()) {
      setError(!token ? 'The map is not set up yet.' : 'Interactive maps are not supported by this browser. Try a browser with WebGL enabled.')
      setState('error')
      callbacks.current.onReady(false)
      return undefined
    }
    const map = new mapboxgl.Map({
      container: container.current, accessToken: token, style: styleById(readPreferredStyleId()).url,
      center: [5.6846, 5.8916], zoom: 14, pitch: 0, bearing: 0,
    })
    mapRef.current = map
    const mapController = createMapController(map)
    mapController.markInitialStyle(styleById(readPreferredStyleId()).id)
    let firstStyle = true
    map.on('style.load', () => { if (firstStyle) { firstStyle = false; return } setStyleEpoch((value) => value + 1) })
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right')
    map.addControl(new mapboxgl.ScaleControl(), 'bottom-left')
    map.on('load', () => { setState('ready'); setController(mapController); callbacks.current.onReady(true) })
    map.on('error', (event) => {
      console.warn('[navigation-map] map_resource_error', { status: event.error?.status })
      setError('A map resource could not load. Check your connection and the existing Mapbox token or plan limits.')
      if (!map.isStyleLoaded()) { setState('error'); callbacks.current.onReady(false) }
    })
    map.on('click', (event) => {
      if (callbacks.current.onPick({ latitude: event.lngLat.lat, longitude: event.lngLat.lng })) return
      const features = map.queryRenderedFeatures(event.point).filter((feature) => feature.layer.id.startsWith('nav-route-line-'))
      if (features.length) callbacks.current.onSelectRoute(Number(features[0].properties.index))
    })
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container.current)
    return () => { observer.disconnect(); callbacks.current.onReady(false); mapRef.current = null; mapController.destroy(); setController(null); map.remove() }
  }, [attempt, token, tokenResolved])

  useEffect(() => {
    const map = mapRef.current
    if (state !== 'ready' || !map) return undefined
    const order = routes.map((_route, index) => index).sort((a, b) => Number(a === selectedRoute) - Number(b === selectedRoute))
    for (const index of order) {
      const source = `nav-route-${index}`
      map.addSource(source, { type: 'geojson', data: {
        type: 'Feature', properties: { index }, geometry: { type: 'LineString', coordinates: routes[index].path.map(coordinates) },
      } })
      map.addLayer({ id: `nav-route-casing-${index}`, type: 'line', source,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fff', 'line-width': index === selectedRoute ? 10 : 7, 'line-opacity': 0.9 } })
      map.addLayer({ id: `nav-route-line-${index}`, type: 'line', source,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': routeColors[index], 'line-width': index === selectedRoute ? 7 : 5, 'line-opacity': index === selectedRoute ? 1 : 0.7 } })
    }
    return () => {
      for (const index of order) {
        if (map.getLayer(`nav-route-line-${index}`)) map.removeLayer(`nav-route-line-${index}`)
        if (map.getLayer(`nav-route-casing-${index}`)) map.removeLayer(`nav-route-casing-${index}`)
        if (map.getSource(`nav-route-${index}`)) map.removeSource(`nav-route-${index}`)
      }
    }
  }, [routes, selectedRoute, state, styleEpoch])

  useEffect(() => {
    if (state !== 'ready' || !mapRef.current) return undefined
    const points = [...(origin ? [{ point: origin, label: 'Start', className: 'nav-origin-marker' }] : []),
      ...stops.filter(Boolean).map((point, index, list) => ({
        point, label: index === list.length - 1 ? 'Destination' : `Stop ${index + 1}`,
        className: index === list.length - 1 ? 'nav-destination-marker' : 'nav-stop-marker', number: index + 1,
      }))]
    const markers = points.map(({ point, label, className, number }) => {
      const wrapper = document.createElement('div')
      wrapper.title = `${label}: ${point.label}`
      const content = document.createElement('span')
      content.className = className
      if (className === 'nav-stop-marker') content.textContent = String(number)
      wrapper.append(content)
      return new mapboxgl.Marker({ element: wrapper }).setLngLat(coordinates(point)).addTo(mapRef.current)
    })
    return () => markers.forEach((marker) => marker.remove())
  }, [origin, stops, state])

  useEffect(() => {
    if (state !== 'ready' || !mapRef.current || !position) return undefined
    const wrapper = document.createElement('div')
    wrapper.title = `Your GPS position, accuracy ${Math.round(position.accuracy)} metres`
    const dot = document.createElement('span')
    dot.className = 'nav-gps-dot'
    if (position.heading != null) {
      const heading = document.createElement('span')
      heading.className = 'nav-heading'
      heading.style.transform = `rotate(${position.heading}deg)`
      dot.append(heading)
    }
    wrapper.append(dot)
    const map = mapRef.current
    const marker = new mapboxgl.Marker({ element: wrapper }).setLngLat(coordinates(position)).addTo(map)
    const ring = Array.from({ length: 65 }, (_value, index) => {
      const angle = index / 64 * Math.PI * 2
      const latitude = position.latitude + Math.sin(angle) * position.accuracy / 111320
      const longitude = position.longitude + Math.cos(angle) * position.accuracy / (111320 * Math.max(0.00001, Math.cos(position.latitude * Math.PI / 180)))
      return [longitude, latitude]
    })
    map.addSource('nav-gps-accuracy', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } } })
    map.addLayer({ id: 'nav-gps-accuracy', type: 'fill', source: 'nav-gps-accuracy', paint: { 'fill-color': '#4285f4', 'fill-opacity': 0.12 } })
    if (following) map.easeTo({ center: coordinates(position), zoom: 17, bearing: position.heading ?? 0, duration: 500 })
    return () => {
      marker.remove()
      if (map.getLayer('nav-gps-accuracy')) map.removeLayer('nav-gps-accuracy')
      if (map.getSource('nav-gps-accuracy')) map.removeSource('nav-gps-accuracy')
    }
  }, [position, following, state, styleEpoch])

  useEffect(() => {
    const map = mapRef.current
    if (state !== 'ready' || !map || following) return undefined
    const points = routes[selectedRoute]?.path || [...(origin ? [origin] : []), ...stops.filter(Boolean)]
    if (!points.length) return undefined
    const fit = () => {
      map.resize()
      if (points.length === 1) map.easeTo({ center: coordinates(points[0]), zoom: 16 })
      else {
        const bounds = new mapboxgl.LngLatBounds()
        points.forEach((point) => bounds.extend(coordinates(point)))
        map.fitBounds(bounds, { padding: 50, maxZoom: 17, duration: 500 })
      }
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [routes, selectedRoute, origin, stops, overviewKey, following, state])

  return <div className="nav-map-stage">
    <div ref={container} className="nav-google-map" aria-label="Interactive Mapbox navigation map" />
    {state !== 'ready' && <div className="nav-map-empty" role={state === 'error' ? 'alert' : 'status'}>
      <span className="nav-empty-orbit" aria-hidden="true">D</span>
      <h2>{state === 'loading' ? 'Opening your map' : 'Map unavailable'}</h2>
      <p>{state === 'loading' ? 'Loading real roads and places using your existing Mapbox service.' : error}</p>
      {state === 'error' && <button type="button" onClick={() => { setError(''); setAttempt((value) => value + 1) }}>Retry map</button>}
    </div>}
    {state === 'ready' && error && <p className="nav-map-resource-warning" role="status">{error}</p>}
    {state === 'ready' && <LayersControl controller={controller} className="nav-map-layers" />}
  </div>
}

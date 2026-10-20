import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Bookmark, Crosshair, HelpCircle, LocateFixed, Search, Trash2, X } from 'lucide-react'
import { createDoorstepMap, describeMapError, featureOf, lineOverlay, SAPELE_CENTER, useMapToken } from './mapCore'
import { LayersControl } from './LayersControl'
import { apiBase, describeGeolocationError, fetchDrivingRoutes, formatDistance, formatDuration, getDevicePosition, resolveGooglePlace, reverseGeocode, searchAddresses } from './addressSearch'

const sourceText = {
  gps: (point) => point.accuracyMeters != null ? `Device GPS · accuracy about ±${Math.round(point.accuracyMeters)} m (this is position uncertainty, not travel distance)` : 'Device GPS · no accuracy reading, check the pin',
  search: () => 'Search result · may mark a road or building centre, move the pin onto the entrance',
  saved: () => 'Saved place · check it is still the right entrance',
  map: () => 'Placed on the map by you',
}

export function describePointSource(point) { return point ? (sourceText[point.source] || sourceText.map)(point) : '' }

function accuracyRing(point) {
  const radius = point.accuracyMeters
  const ring = Array.from({ length: 49 }, (_value, index) => {
    const angle = index / 48 * Math.PI * 2
    return [
      point.longitude + Math.cos(angle) * radius / (111_320 * Math.max(0.00001, Math.cos(point.latitude * Math.PI / 180))),
      point.latitude + Math.sin(angle) * radius / 111_320,
    ]
  })
  return featureOf({ type: 'Polygon', coordinates: [ring] })
}

function markerElement(target) {
  const element = document.createElement('div')
  element.className = `map-point-marker ${target.markerClass || ''}`
  element.setAttribute('role', 'img')
  element.setAttribute('aria-label', target.label)
  const badge = document.createElement('span')
  badge.textContent = target.badge || ''
  element.append(badge)
  return element
}

function useSavedPlaces(enabled) {
  const [places, setPlaces] = useState([])
  useEffect(() => {
    const token = (() => { try { return localStorage.getItem('doorstep-token') } catch { return null } })()
    if (!enabled || !token) return undefined
    let active = true
    fetch(`${apiBase}/api/addresses`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : { addresses: [] })
      .then((body) => {
        if (!active) return
        const list = (body.addresses || []).filter((address) => address.latitude != null && address.longitude != null)
          .map((address) => ({ id: address.id, label: address.label, address: address.addressLine, latitude: Number(address.latitude), longitude: Number(address.longitude) }))
        setPlaces(list.slice(0, 6))
      }).catch(() => undefined)
    return () => { active = false }
  }, [enabled])
  return places
}

/**
 * Interactive Mapbox picker for one or more named points (e.g. pickup and
 * destination). The parent owns the selected points; this component handles
 * search, GPS, tapping, dragging, saved places, route preview and the map.
 */
export function MapPointPicker({
  targets,
  value,
  onChange,
  activeKey: controlledActiveKey,
  onActiveKeyChange,
  heading,
  onClose,
  routeMode = 'between',
  selectedRouteId = '0',
  onRoutes,
  onSelectRoute,
  savedPlaces = true,
  children,
}) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const controllerRef = useRef(null)
  const markersRef = useRef({})
  const searchAbortRef = useRef(null)
  const suppressSearchRef = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value
  const [internalActive, setInternalActive] = useState(targets[0].key)
  const activeKey = controlledActiveKey ?? internalActive
  const activeKeyRef = useRef(activeKey)
  activeKeyRef.current = activeKey
  const routeSelectionRef = useRef({ selectedRouteId, onSelectRoute })
  routeSelectionRef.current = { selectedRouteId, onSelectRoute }
  const setActiveKey = (key) => { setInternalActive(key); onActiveKeyChange?.(key) }
  const activeTarget = targets.find((target) => target.key === activeKey) || targets[0]
  const { token: mapToken, resolved: tokenResolved } = useMapToken()
  const [mapState, setMapState] = useState('loading')
  const [mapProblem, setMapProblem] = useState('')
  useEffect(() => {
    if (mapToken) { setMapState((state) => state === 'no-token' ? 'loading' : state); setMapProblem((problem) => problem.startsWith('The map is not set up') ? '' : problem) }
    else if (tokenResolved) { setMapState('no-token'); setMapProblem('The map is not set up yet. You can still search for an address or use GPS.') }
  }, [mapToken, tokenResolved])
  const [controller, setController] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searchState, setSearchState] = useState('idle')
  const [searchMessage, setSearchMessage] = useState('')
  const [gpsState, setGpsState] = useState('idle')
  const [message, setMessage] = useState('')
  const [routes, setRoutes] = useState([])
  const [routeState, setRouteState] = useState('idle')
  const places = useSavedPlaces(savedPlaces)

  // Hide the floating chat bubble while a full map screen is open; help stays reachable from the header.
  useEffect(() => {
    document.body.classList.add('doorstep-map-screen')
    return () => document.body.classList.remove('doorstep-map-screen')
  }, [])

  const updatePoint = useCallback((key, point) => {
    onChange({ ...valueRef.current, [key]: point })
  }, [onChange])

  const labelPoint = useCallback((key, point) => {
    reverseGeocode(point).then((label) => {
      if (!label) return
      const current = valueRef.current[key]
      if (current && current.latitude === point.latitude && current.longitude === point.longitude && current.source === 'map') onChange({ ...valueRef.current, [key]: { ...current, label } })
    }).catch(() => undefined)
  }, [onChange])

  // ------------------------------ map setup --------------------------------
  useEffect(() => {
    if (!mapElement.current || mapRef.current || !mapToken) return undefined
    if (!mapboxgl.supported()) {
      setMapState('unsupported')
      setMapProblem('This browser cannot display the interactive map. You can still search for an address or use GPS.')
      return undefined
    }
    const first = targets.map((target) => valueRef.current[target.key]).find(Boolean)
    const created = createDoorstepMap(mapElement.current, { center: first ? [first.longitude, first.latitude] : SAPELE_CENTER, zoom: first ? 15 : 13 })
    const { map, controller: mapController } = created
    mapRef.current = map
    controllerRef.current = mapController
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right')
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left')
    map.on('load', () => { setMapState('ready'); setController(mapController); window.requestAnimationFrame(() => map.resize()) })
    map.on('error', (event) => {
      const problem = describeMapError(event)
      if (problem.code === 'TOKEN_INVALID' || problem.code === 'TOKEN_RESTRICTED') { setMapState('error'); setMapProblem(`${problem.message} Search and GPS still work.`) }
    })
    map.on('click', (event) => {
      // Tapping an alternative route line selects that route instead of moving a pin.
      const routeLayers = [0, 1, 2].map((index) => `preview-route-${index}-line`).filter((id) => map.getLayer(id))
      const { selectedRouteId: selectedId, onSelectRoute: selectRoute } = routeSelectionRef.current
      if (selectRoute && routeLayers.length) {
        const hit = map.queryRenderedFeatures([[event.point.x - 6, event.point.y - 6], [event.point.x + 6, event.point.y + 6]], { layers: routeLayers }).find((feature) => String(feature.properties.index) !== selectedId)
        if (hit) { selectRoute(String(hit.properties.index)); return }
      }
      const key = activeKeyRef.current
      const point = { latitude: event.lngLat.lat, longitude: event.lngLat.lng, label: 'Pinned map location', source: 'map', accuracyMeters: null }
      updatePoint(key, point)
      labelPoint(key, point)
      map.easeTo({ center: event.lngLat, zoom: Math.max(map.getZoom(), 17), duration: 600 })
    })
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(mapElement.current)
    return () => {
      observer.disconnect()
      Object.values(markersRef.current).forEach((marker) => marker.remove())
      markersRef.current = {}
      mapController.destroy()
      map.remove()
      mapRef.current = null
      controllerRef.current = null
    }
  }, [mapToken])

  // ------------------------------ markers ----------------------------------
  useEffect(() => {
    const map = mapRef.current
    const controllerNow = controllerRef.current
    if (!map || !controllerNow) return
    for (const target of targets) {
      const point = value[target.key]
      const existing = markersRef.current[target.key]
      if (!point) {
        existing?.remove()
        delete markersRef.current[target.key]
        controllerNow.removeOverlay(`accuracy-${target.key}`)
        continue
      }
      if (existing) existing.setLngLat([point.longitude, point.latitude])
      else {
        const marker = new mapboxgl.Marker({ element: markerElement(target), draggable: true, anchor: 'bottom' }).setLngLat([point.longitude, point.latitude]).addTo(map)
        marker.on('dragend', () => {
          const position = marker.getLngLat()
          const moved = { latitude: position.lat, longitude: position.lng, label: 'Adjusted map location', source: 'map', accuracyMeters: null }
          setActiveKey(target.key)
          updatePoint(target.key, moved)
          labelPoint(target.key, moved)
        })
        markersRef.current[target.key] = marker
      }
      markersRef.current[target.key].getElement().classList.toggle('is-active', target.key === activeKey)
      if (point.source === 'gps' && Number.isFinite(point.accuracyMeters) && point.accuracyMeters > 0) {
        const id = `accuracy-${target.key}`
        if (controllerNow.hasOverlay(id)) controllerNow.updateOverlayData(id, accuracyRing(point))
        else controllerNow.setOverlay(id, { type: 'geojson', data: accuracyRing(point) }, [{ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 } }, { id: `${id}-edge`, type: 'line', source: id, paint: { 'line-color': '#1a73e8', 'line-width': 1, 'line-opacity': 0.5 } }])
      } else controllerNow.removeOverlay(`accuracy-${target.key}`)
    }
  }, [value, activeKey, mapState])

  // --------------------------- route preview -------------------------------
  const routeEnds = useMemo(() => {
    if (routeMode === 'between' && targets.length >= 2) {
      const a = value[targets[0].key]
      const b = value[targets[1].key]
      return a && b ? [a, b] : null
    }
    if (routeMode === 'fromCenter') {
      const b = value[targets[0].key]
      return b ? [{ latitude: SAPELE_CENTER[1], longitude: SAPELE_CENTER[0] }, b] : null
    }
    return null
  }, [value, routeMode])
  const routeKey = routeEnds ? routeEnds.map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`).join(';') : ''

  useEffect(() => {
    if (!routeEnds || !mapToken) { setRoutes([]); setRouteState('idle'); onRoutes?.([]); return undefined }
    const controller = new AbortController()
    setRouteState('loading')
    const timer = window.setTimeout(() => {
      fetchDrivingRoutes(routeEnds[0], routeEnds[1], { alternatives: routeMode === 'between', signal: controller.signal })
        .then((found) => { setRoutes(found); setRouteState('ready'); onRoutes?.(found) })
        .catch((error) => {
          if (error.name === 'AbortError') return
          setRoutes([]); setRouteState('error'); onRoutes?.([])
          setMessage(error.code === 'NO_ROUTE' ? 'No road route connects these points. Move a pin onto or next to a road.' : 'Road route preview is unavailable right now. Your pins are still saved.')
        })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [routeKey, mapToken])

  useEffect(() => {
    const controllerNow = controllerRef.current
    if (!controllerNow) return
    for (const index of [0, 1, 2]) controllerNow.removeOverlay(`preview-route-${index}`)
    // Alternatives first, selected route last so it is drawn on top.
    const ordered = [...routes].sort((a, b) => Number(a.id === selectedRouteId) - Number(b.id === selectedRouteId))
    for (const route of ordered) {
      const id = `preview-route-${route.id}`
      const selected = route.id === selectedRouteId
      controllerNow.setOverlay(id, { type: 'geojson', data: featureOf(route.geometry, { index: Number(route.id) }) }, lineOverlay(id, selected ? { color: '#007c63', width: 6 } : { color: '#7b8f86', width: 4, opacity: 0.75, dashed: true }), { slot: 'middle' })
    }
  }, [routes, selectedRouteId, mapState])

  // Fit both points into view when they change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapState !== 'ready') return
    const points = targets.map((target) => value[target.key]).filter(Boolean)
    if (points.length >= 2) {
      const bounds = new mapboxgl.LngLatBounds()
      points.forEach((point) => bounds.extend([point.longitude, point.latitude]))
      routes.find((route) => route.id === selectedRouteId)?.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate))
      map.fitBounds(bounds, { padding: { top: 70, bottom: 40, left: 40, right: 60 }, maxZoom: 16, duration: 700 })
    }
  }, [routeKey, routes.length, mapState])

  // ------------------------------ search -----------------------------------
  const runSearch = useCallback(async (text) => {
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    setSearchState('loading')
    setSearchMessage('')
    try {
      const { results: found, partial } = await searchAddresses(text, { signal: controller.signal })
      if (controller.signal.aborted) return
      setResults(found)
      setSearchState(found.length ? 'ready' : 'empty')
      setSearchMessage(found.length ? (partial ? 'Some search sources did not respond; showing what was found.' : '') : `No verified match for “${text}”. Try a nearby landmark, or tap the map to place the ${activeTarget.shortLabel || activeTarget.label} pin yourself.`)
    } catch (error) {
      if (error.name === 'AbortError') return
      setResults([])
      setSearchState('error')
      setSearchMessage(error.message || 'Address search is unavailable right now. You can still tap the map.')
    }
  }, [activeTarget])

  useEffect(() => {
    if (suppressSearchRef.current) { suppressSearchRef.current = false; return undefined }
    const text = query.trim()
    if (text.length < 3) { searchAbortRef.current?.abort(); setResults([]); setSearchState('idle'); setSearchMessage(''); return undefined }
    const timer = window.setTimeout(() => runSearch(text), 400)
    return () => window.clearTimeout(timer)
  }, [query])

  const placeAt = (key, point, zoom = 17) => {
    updatePoint(key, point)
    mapRef.current?.flyTo({ center: [point.longitude, point.latitude], zoom, duration: 800, essential: true })
  }

  const chooseResult = async (result) => {
    try {
      const resolved = result.source === 'google' ? await resolveGooglePlace(result.placeId) : { coordinates: result.coordinates, label: [result.name, result.label].filter(Boolean).join(', ') }
      placeAt(activeKey, { latitude: resolved.coordinates[1], longitude: resolved.coordinates[0], label: resolved.label || result.name, source: 'search', accuracyMeters: null })
      suppressSearchRef.current = true
      setQuery('')
      setResults([])
      setSearchState('idle')
      setMessage(`${activeTarget.label} set. Drag the pin if it is not exactly at the entrance.`)
    } catch (error) {
      setSearchMessage(error.message)
    }
  }

  const useGps = async () => {
    setGpsState('locating')
    setMessage('Finding your location…')
    try {
      const position = await getDevicePosition()
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude, label: 'Current device location', source: 'gps', accuracyMeters: position.coords.accuracy }
      placeAt(activeKey, point, 17)
      reverseGeocode(point).then((label) => { if (label) { const current = valueRef.current[activeKeyRef.current]; if (current?.source === 'gps' && current.latitude === point.latitude) updatePoint(activeKeyRef.current, { ...current, label }) } }).catch(() => undefined)
      setGpsState('idle')
      setMessage(position.coords.accuracy > 80 ? `GPS is only accurate to about ±${Math.round(position.coords.accuracy)} m here. Check the pin and drag it to the exact spot.` : `${activeTarget.label} set from GPS. Check the pin before continuing.`)
    } catch (error) {
      setGpsState('error')
      setMessage(describeGeolocationError(error))
    }
  }

  const clearActive = () => {
    updatePoint(activeKey, null)
    setMessage(`${activeTarget.label} cleared.`)
  }

  const recenter = () => {
    const map = mapRef.current
    const point = value[activeKey]
    if (!map) return
    map.flyTo({ center: point ? [point.longitude, point.latitude] : SAPELE_CENTER, zoom: point ? 16 : 13, bearing: 0, pitch: 0, duration: 700 })
  }

  const activePoint = value[activeKey]
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) || routes[0]

  return <section className="map-picker" aria-label={heading?.title || 'Choose a location'}>
    <header className="map-picker-head">
      <div>
        {heading?.kicker && <span className="section-kicker">{heading.kicker}</span>}
        <h2>{heading?.title || 'Choose a location'}</h2>
        {heading?.intro && <p>{heading.intro}</p>}
      </div>
      <div className="map-picker-head-actions">
        <button type="button" className="map-icon-button" aria-label="Open help chat" title="Help" onClick={() => window.dispatchEvent(new Event('doorstep-open-chat'))}><HelpCircle size={18} /></button>
        {onClose && <button type="button" className="map-icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>}
      </div>
    </header>

    {targets.length > 1 && <div className="map-picker-targets" role="tablist" aria-label="Which point are you setting?">
      {targets.map((target) => {
        const point = value[target.key]
        return <button key={target.key} type="button" role="tab" aria-selected={target.key === activeKey} className={`map-picker-target ${target.markerClass || ''}${target.key === activeKey ? ' is-active' : ''}`} onClick={() => setActiveKey(target.key)}>
          <i aria-hidden="true">{target.badge}</i>
          <span><small>{target.label}</small><strong>{point?.label || 'Not set'}</strong></span>
        </button>
      })}
    </div>}

    <div className="map-picker-toolbar">
      <form className="map-picker-search" role="search" onSubmit={(event) => { event.preventDefault(); if (query.trim().length >= 2) runSearch(query.trim()) }}>
        <Search size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor={`map-search-${activeKey}`}>Search for the {activeTarget.label.toLowerCase()}</label>
        <input id={`map-search-${activeKey}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${activeTarget.shortLabel || activeTarget.label.toLowerCase()}: street, landmark, business`} autoComplete="off" enterKeyHint="search" />
        {query && <button type="button" className="map-picker-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); setResults([]); setSearchState('idle') }}><X size={15} /></button>}
      </form>
      <button type="button" className="map-picker-gps" onClick={useGps} disabled={gpsState === 'locating'} aria-label={`Use my current location for the ${activeTarget.label.toLowerCase()}`}><LocateFixed size={18} /><span>{gpsState === 'locating' ? 'Locating…' : 'Use GPS'}</span></button>
    </div>

    {(searchState !== 'idle' || results.length > 0) && <div className="map-picker-results" role="listbox" aria-label="Search results" aria-busy={searchState === 'loading'}>
      {searchState === 'loading' && <p className="map-picker-results-note" role="status">Searching Nigerian addresses and places…</p>}
      {results.map((result) => <button key={`${result.source}:${result.id}`} type="button" role="option" aria-selected="false" onClick={() => chooseResult(result)}>
        <strong>{result.name}</strong><span>{result.label}</span>
      </button>)}
      {searchMessage && <p className="map-picker-results-note" role="status">{searchMessage}</p>}
    </div>}

    {places.length > 0 && <div className="map-picker-saved" aria-label="Saved places">
      {places.map((place) => <button key={place.id} type="button" onClick={() => placeAt(activeKey, { latitude: place.latitude, longitude: place.longitude, label: `${place.label} · ${place.address}`, source: 'saved', accuracyMeters: null })}><Bookmark size={14} aria-hidden="true" />{place.label}</button>)}
    </div>}

    <div className="map-picker-stage">
      <div className="map-picker-canvas" ref={mapElement} aria-label="Interactive map. Tap to place the selected pin." />
      {mapState === 'ready' && <LayersControl controller={controller} />}
      {mapState === 'ready' && <button type="button" className="map-recenter-button" aria-label="Recenter map" title="Recenter" onClick={recenter}><Crosshair size={18} /></button>}
      {mapState !== 'ready' && <div className="map-picker-overlay" role={mapState === 'loading' ? 'status' : 'alert'}>{mapState === 'loading' ? 'Loading live map…' : mapProblem}</div>}
    </div>

    <div className="map-picker-sheet">
      <div className="map-picker-sheet-point">
        <span className="section-kicker">{activeTarget.label.toUpperCase()}</span>
        <strong>{activePoint?.label || `Search, use GPS, or tap the map to set the ${activeTarget.label.toLowerCase()}.`}</strong>
        {activePoint && <small className="map-picker-coords">{activePoint.latitude.toFixed(6)}, {activePoint.longitude.toFixed(6)}</small>}
        {activePoint && <small className="map-picker-source">{describePointSource(activePoint)}</small>}
        {activePoint && <button type="button" className="map-picker-clear" onClick={clearActive}><Trash2 size={14} /> Clear {activeTarget.shortLabel || 'point'}</button>}
      </div>
      {routeEnds && <div className="map-picker-route" aria-live="polite">
        {routeState === 'loading' && <span>Checking road route…</span>}
        {routeState === 'ready' && selectedRoute && <span><strong>{formatDistance(selectedRoute.distanceMeters)}</strong> by road · about <strong>{formatDuration(selectedRoute.durationSeconds)}</strong> driving{routeMode === 'fromCenter' ? ' from central Sapele (preview)' : ''}</span>}
        {routeState === 'ready' && routes.length > 1 && onSelectRoute && <div className="map-picker-route-options" role="radiogroup" aria-label="Route options">
          {routes.map((route, index) => <button key={route.id} type="button" role="radio" aria-checked={route.id === (selectedRoute?.id)} onClick={() => onSelectRoute(route.id)}>{index === 0 ? 'Fastest' : `Option ${index + 1}`} · {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}</button>)}
        </div>}
        {routeState === 'error' && <span>Road route unavailable.</span>}
      </div>}
      {message && <p className="map-picker-message" role="status">{message}</p>}
    </div>
    {/* Sticky so the confirm action stays reachable while the page scrolls on small screens. */}
    {children && <div className="map-picker-footer">{children}</div>}
  </section>
}

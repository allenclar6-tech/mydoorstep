import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { LocateFixed, X } from 'lucide-react'
import { sapeleDeliveryDirectory } from './data'
import { readConfirmedLocation } from './location'

const token = import.meta.env.VITE_MAP_PUBLIC_TOKEN || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const apiBase = globalThis.location?.hostname === 'mydoorstep.com.co' ? '' : import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const sapeleCenter = [5.6846, 5.8916]

function createPin() {
  const element = document.createElement('div')
  element.className = 'delivery-destination-marker'
  element.setAttribute('aria-hidden', 'true')
  return element
}

function featureLabel(feature) {
  return feature.properties?.full_address || feature.place_name || [feature.properties?.name, feature.properties?.place_formatted].filter(Boolean).join(', ') || 'Selected map location'
}

async function reverseGeocode(point) {
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${encodeURIComponent(point.lng)}&latitude=${encodeURIComponent(point.lat)}&access_token=${encodeURIComponent(token)}`)
  if (!response.ok) throw new Error(`Reverse geocoding failed with ${response.status}`)
  const data = await response.json()
  return data.features?.[0] ? featureLabel(data.features[0]) : null
}

export function LocationMap({ onSelect, onCancel }) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const geolocateControlRef = useRef(null)
  const placeDestinationRef = useRef(null)
  const routePreviewRef = useRef(null)
  const abortControllerRef = useRef(null)
  const suppressAutocompleteRef = useRef(false)
  const [message, setMessage] = useState(token ? 'Search for an address or place the pin exactly at your doorstep.' : 'Map configuration is unavailable.')
  const [precision, setPrecision] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [googleResults, setGoogleResults] = useState([])
  const [unmappedQuery, setUnmappedQuery] = useState('')
  const [selectingGooglePlace, setSelectingGooglePlace] = useState('')
  const [searching, setSearching] = useState(false)
  const [initialLocation] = useState(() => readConfirmedLocation())
  const [selectedPoint, setSelectedPoint] = useState(initialLocation)
  const [mapState, setMapState] = useState(token ? 'loading' : 'unavailable')
  const [routeInfo, setRouteInfo] = useState('')

  useEffect(() => {
    if (!token || !mapElement.current || mapRef.current) return undefined
    if (!mapboxgl.supported()) {
      setMapState('unsupported')
      setMessage('Your browser cannot display the interactive map, but you can still search, use GPS, and confirm an exact location.')
      return undefined
    }
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: mapElement.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: initialLocation ? [initialLocation.longitude, initialLocation.latitude] : sapeleCenter,
      zoom: 13,
      pitch: 0,
      bearing: 0,
      antialias: true,
    })
    const geolocateControl = new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      trackUserLocation: true,
      showAccuracyCircle: true,
      showUserHeading: true,
      fitBoundsOptions: { maxZoom: 18.5 },
    })

    const placeDestination = (coordinates, point, label = 'Pinned map location', source = 'map', accuracyMeters = null) => {
      markerRef.current?.remove()
      markerRef.current = new mapboxgl.Marker({
        element: createPin(),
        draggable: true,
        anchor: 'bottom',
      }).setLngLat(coordinates).addTo(map)
      setSelectedPoint({ latitude: point.lat, longitude: point.lng, label, source, accuracyMeters })
      setPrecision(source === 'gps'
        ? accuracyMeters != null ? `Device GPS estimate: about ±${Math.round(accuracyMeters)} m. Move the pin onto your entrance if needed.` : 'Saved GPS point has no accuracy reading. Verify the pin on the map before confirming.'
        : source === 'search' ? 'Search result position may mark a road or building center. Move the pin onto your exact entrance.' : 'Map pin placed manually. Verify it is on the exact entrance before confirming.')
      setMessage('Fine-tune the pin, then confirm this delivery location.')
      markerRef.current.on('dragend', () => {
        const destination = markerRef.current.getLngLat()
        setSelectedPoint({
          latitude: destination.lat,
          longitude: destination.lng,
          label: 'Adjusted map location',
          source: 'map',
          accuracyMeters: null,
        })
        setPrecision('Pin adjusted manually. Verify it is on the exact entrance before confirming.')
        setMessage('Pin adjusted. Confirm when it matches your doorstep.')
        routePreviewRef.current?.([destination.lng, destination.lat])
        reverseGeocode(destination).then((label) => {
          if (label) setSelectedPoint((current) => current && current.latitude === destination.lat && current.longitude === destination.lng ? { ...current, label } : current)
        }).catch(() => setMessage('Pin adjusted. We could not resolve its address name, but the exact delivery point is still selected.'))
      })
      reverseGeocode(point).then((resolvedLabel) => {
        if (resolvedLabel) setSelectedPoint((current) => current && current.latitude === point.lat && current.longitude === point.lng ? { ...current, label: resolvedLabel } : current)
      }).catch(() => setMessage('Exact delivery point selected. We could not resolve an address name yet.'))
      routePreviewRef.current?.(coordinates)
    }

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new mapboxgl.FullscreenControl(), 'top-right')
    map.addControl(geolocateControl, 'top-right')
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left')
    geolocateControlRef.current = geolocateControl
    placeDestinationRef.current = placeDestination

    map.on('style.load', () => {
      routePreviewRef.current = async (coordinates) => {
          try {
            const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${sapeleCenter.join(',')};${coordinates.join(',')}?geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(token)}`)
            if (!response.ok) throw new Error(`Route request failed with ${response.status}`)
            const route = (await response.json()).routes?.[0]
            if (!route?.geometry) throw new Error('No route returned')
            const sourceData = { type: 'Feature', properties: {}, geometry: route.geometry }
            const source = map.getSource('doorstep-route-preview')
            if (source) source.setData(sourceData)
            else {
              map.addSource('doorstep-route-preview', { type: 'geojson', data: sourceData })
              map.addLayer({ id: 'doorstep-route-casing', type: 'line', source: 'doorstep-route-preview', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': .9 } })
              map.addLayer({ id: 'doorstep-route-line', type: 'line', source: 'doorstep-route-preview', paint: { 'line-color': '#007c63', 'line-width': 4, 'line-opacity': .95 } })
            }
        setRouteInfo(`${(route.distance / 1000).toFixed(1)} km · about ${Math.max(1, Math.ceil(route.duration / 60))} min by road from central Sapele`)
      } catch {
        setRouteInfo('Route estimate is unavailable for this destination. Your exact pin is still selected.')
      }
    }
      setMapState('ready')
      requestAnimationFrame(() => map.resize())
      if (initialLocation) {
        placeDestinationRef.current(
          [initialLocation.longitude, initialLocation.latitude],
          { lat: initialLocation.latitude, lng: initialLocation.longitude },
          initialLocation.label,
          initialLocation.source || 'search',
          initialLocation.accuracyMeters ?? null,
        )
      }
    })
    map.on('click', (event) => {
      const coordinates = [event.lngLat.lng, event.lngLat.lat]
      placeDestination(coordinates, event.lngLat)
      map.easeTo({ center: coordinates, zoom: Math.max(map.getZoom(), 18), pitch: 0, bearing: 0, duration: 900 })
    })
    geolocateControl.on('geolocate', (position) => {
      const coordinates = [position.coords.longitude, position.coords.latitude]
      const point = { lat: position.coords.latitude, lng: position.coords.longitude }
      const accuracy = Math.round(position.coords.accuracy)
      placeDestination(coordinates, point, 'Current device location', 'gps', position.coords.accuracy)
      map.flyTo({ center: coordinates, zoom: 17, pitch: 0, bearing: 0, duration: 1_000 })
    })
    geolocateControl.on('error', () => {
      setMessage('We could not access precise location. Check browser permission or place the pin manually.')
    })
    map.on('error', (event) => {
      if (event.error?.status === 401 || event.error?.status === 403) {
        setMapState('unavailable')
        setMessage('The live map is temporarily unavailable. You can still choose a delivery area below.')
      }
    })
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(mapElement.current)
    const loadingTimer = window.setTimeout(() => setMapState('ready'), 1_500)

    mapRef.current = map
    return () => {
      abortControllerRef.current?.abort()
      resizeObserver.disconnect()
      window.clearTimeout(loadingTimer)
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
      geolocateControlRef.current = null
      placeDestinationRef.current = null
      routePreviewRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return undefined
    const frame = window.requestAnimationFrame(() => mapRef.current?.resize())
    return () => window.cancelAnimationFrame(frame)
  }, [selectedPoint, results.length, googleResults.length])

  const useDeviceLocation = () => {
    const map = mapRef.current
    const geolocateControl = geolocateControlRef.current
    setMessage('Finding your precise location…')
    setPrecision('Measuring GPS accuracy')
    if (geolocateControl?.trigger()) return
    if (!navigator.geolocation) {
      setMessage('This browser cannot provide location. Open DOORSTEP in your phone browser and allow location access.')
      setPrecision('')
      return
    }
    navigator.geolocation.getCurrentPosition((position) => {
      const coordinates = [position.coords.longitude, position.coords.latitude]
      const point = { lat: position.coords.latitude, lng: position.coords.longitude }
      if (map && placeDestinationRef.current) {
        placeDestinationRef.current(coordinates, point, 'Current device location', 'gps', position.coords.accuracy)
        map.flyTo({ center: coordinates, zoom: 18, pitch: 0, bearing: 0, duration: 1_200, essential: false })
      } else {
        setSelectedPoint({ latitude: point.lat, longitude: point.lng, label: 'Current device location', source: 'gps', accuracyMeters: position.coords.accuracy })
        setPrecision(`Device GPS estimate: about ±${Math.round(position.coords.accuracy)} m. Move the pin onto your entrance if needed.`)
        setMessage('Location captured. The map will update as soon as it is available.')
        reverseGeocode(point).then((label) => {
          if (label) setSelectedPoint((current) => current && current.latitude === point.lat && current.longitude === point.lng ? { ...current, label } : current)
        }).catch(() => setMessage('Location captured. We could not resolve its address name yet.'))
      }
    }, (error) => {
      const details = error.code === error.TIMEOUT ? 'Location timed out. Move outdoors or check your signal, then try again.' : error.code === error.POSITION_UNAVAILABLE ? 'Your phone could not determine a location yet. Move outdoors and try again.' : 'Location permission was not granted. Search or tap the map to choose your doorstep.'
      setMessage(details)
      setPrecision('')
    }, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    })
  }

  const searchPlaces = async (query = search.trim()) => {
    if (!query) return
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    setSearching(true)
    setUnmappedQuery('')
    setGoogleResults([])
    setMessage('Searching Nigerian addresses, landmarks, and roads…')
    try {
      const directoryMatch = sapeleDeliveryDirectory.find((location) => location.name.toLowerCase() === query.toLowerCase())
      const nigeriaQuery = /\bnigeria\b/i.test(query) ? query : directoryMatch ? `${directoryMatch.name}, Sapele, Delta State, Nigeria` : `${query}, Nigeria`
      const [mapboxResult, googleResult] = await Promise.allSettled([
        token ? fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(nigeriaQuery)}&country=ng&types=address,street,neighborhood,locality,place&proximity=${sapeleCenter.join(',')}&autocomplete=true&limit=8&access_token=${encodeURIComponent(token)}`, { signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error(`Map search failed with ${response.status}`)
          return response.json()
        }) : Promise.resolve({ features: [] }),
        fetch(`${apiBase}/api/locations/google/autocomplete?query=${encodeURIComponent(nigeriaQuery)}`, { signal: controller.signal }).then(async (response) => response.ok ? response.json() : { results: [] }),
      ])
      if (mapboxResult.status === 'rejected' && googleResult.status === 'rejected') throw mapboxResult.reason
      const data = mapboxResult.status === 'fulfilled' ? mapboxResult.value : { features: [] }
      const googleData = googleResult.status === 'fulfilled' ? googleResult.value : { results: [] }
      const features = Array.isArray(data.features) ? data.features : []
      setResults(features)
      const googlePlaces = Array.isArray(googleData.results) ? googleData.results : []
      setGoogleResults(googlePlaces)
      if (features.length || googlePlaces.length) {
        setMessage('Choose the closest verified result. It will centre the map and place a delivery pin that you can refine.')
      } else {
        setUnmappedQuery(query)
        setMessage('We could not verify that place on the map. Use a nearby landmark or manually place the pin at the exact spot.')
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        setResults([])
        setGoogleResults([])
        setUnmappedQuery('')
        setMessage('Address search is unavailable right now. You can still pin the map manually.')
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setSearching(false)
      }
    }
  }

  useEffect(() => {
    if (suppressAutocompleteRef.current) {
      suppressAutocompleteRef.current = false
      return undefined
    }
    const query = search.trim()
    if (query.length < 3) {
      abortControllerRef.current?.abort()
      setResults([])
      setGoogleResults([])
      setUnmappedQuery('')
      return undefined
    }
    const timeout = window.setTimeout(() => searchPlaces(query), 350)
    return () => window.clearTimeout(timeout)
  }, [search])

  const selectLocation = (coordinates, label) => {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return
    const point = { lng: coordinates[0], lat: coordinates[1] }
    if (mapRef.current && placeDestinationRef.current) {
      placeDestinationRef.current(coordinates, point, label, 'search')
      mapRef.current.flyTo({ center: coordinates, zoom: 18, pitch: 0, bearing: 0, duration: 1_000 })
    } else {
      setSelectedPoint({ latitude: point.lat, longitude: point.lng, label, source: 'search', accuracyMeters: null })
      setPrecision('Search result position may mark a road or building center. Move the pin onto your exact entrance.')
      setMessage('Address selected. Confirm the coordinates below to use this delivery location.')
    }
    suppressAutocompleteRef.current = true
    setSearch(label)
    setResults([])
    setUnmappedQuery('')
  }

  const chooseResult = (feature) => {
    selectLocation(feature.geometry?.coordinates, featureLabel(feature))
    setGoogleResults([])
  }

  const chooseGooglePlace = async (place) => {
    setSelectingGooglePlace(place.placeId)
    setMessage('Finding the exact Google place location…')
    try {
      const response = await fetch(`${apiBase}/api/locations/google/${encodeURIComponent(place.placeId)}`)
      if (!response.ok) throw new Error(`Google place request failed with ${response.status}`)
      const data = await response.json()
      const location = data.location
      selectLocation([location.longitude, location.latitude], location.label)
      setGoogleResults([])
    } catch {
      setMessage('Google could not provide coordinates for that place. Choose a Mapbox result or pin the exact location manually.')
    } finally {
      setSelectingGooglePlace('')
    }
  }

  const startManualPinning = () => {
    const map = mapRef.current
    if (map) {
      map.flyTo({ center: map.getCenter(), zoom: Math.max(map.getZoom(), 15), pitch: 0, bearing: 0, duration: 700 })
    }
    setResults([])
    setGoogleResults([])
    setUnmappedQuery('')
    setMessage('Tap the exact entrance or building on the map to drop your delivery pin.')
  }

  const confirmLocation = () => {
    if (!selectedPoint) return
    const confirmedLocation = {
      latitude: selectedPoint.latitude,
      longitude: selectedPoint.longitude,
      label: selectedPoint.label,
      source: selectedPoint.source,
      accuracyMeters: selectedPoint.accuracyMeters,
    }
    localStorage.setItem('doorstep-location-coordinates', JSON.stringify(confirmedLocation))
    window.dispatchEvent(new Event('doorstep-location-change'))
    onSelect(confirmedLocation)
    setMessage('Delivery location confirmed. You can now browse stores serving this area.')
  }

  return <section className="location-map-card delivery-map-experience" aria-labelledby="delivery-map-title">
    <header className="delivery-map-welcome">
      <div className="delivery-map-orbit" aria-hidden="true"><span /><i /></div>
      <div>
        <span className="section-kicker">DOORSTEP DELIVERY · SAPELE</span>
        <h2 id="delivery-map-title">Set your delivery point</h2>
        <p>Search an address, use your location, or tap the map to place your doorstep pin.</p>
      </div>
      <button className="delivery-map-close" type="button" onClick={onCancel} aria-label="Close location picker"><X size={19} /></button>
    </header>
    <div className="delivery-map-toolbar">
      <form className="delivery-map-search" role="search" onSubmit={(event) => { event.preventDefault(); searchPlaces() }}>
        <label className="sr-only" htmlFor="delivery-location-search">Search for a delivery address</label>
        <input id="delivery-location-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search an address, landmark or road" autoComplete="street-address" />
        <button type="submit" disabled={searching} aria-label={searching ? 'Searching addresses' : 'Find address'}>{searching ? '...' : 'Search'}</button>
      </form>
      <button className="map-locate-button" type="button" onClick={useDeviceLocation}><LocateFixed size={18} /><span>Use my location</span></button>
    </div>
    {(results.length > 0 || googleResults.length > 0 || unmappedQuery) && <div className="delivery-search-results" role="listbox" aria-label="Address search results">
      {results.map((feature) => <button key={feature.properties?.mapbox_id || feature.id || featureLabel(feature)} type="button" onClick={() => chooseResult(feature)}><strong>{feature.properties?.name || feature.text || 'Location'}</strong><span>{featureLabel(feature)}</span></button>)}
      {googleResults.map((place) => <button key={place.placeId} type="button" disabled={selectingGooglePlace === place.placeId} onClick={() => chooseGooglePlace(place)}><strong>{selectingGooglePlace === place.placeId ? 'Locating place…' : place.label}</strong><span>{place.secondaryLabel || 'Google Places result'}</span></button>)}
      {unmappedQuery && <button className="delivery-manual-pin-option" type="button" onClick={startManualPinning}><strong>Place "{unmappedQuery}" manually</strong><span>Tap the exact spot on the map, then drag the pin to the entrance.</span></button>}
    </div>}
    <div className="location-map-shell">
      <div className="location-map" ref={mapElement} aria-label="Interactive delivery location map" />
      {mapState !== 'ready' && <div className="map-loading-state" role="status"><span className="location-pulse" />{mapState === 'loading' ? 'Loading live map…' : mapState === 'unsupported' ? 'Map view unavailable in this browser. Search or use GPS instead.' : 'Map is unavailable. Search or use GPS instead.'}</div>}
      {mapState === 'ready' && <div className="map-interaction-hint"><span className="location-pulse" />Tap the map or move the pin to your entrance</div>}
    </div>
    <div className="delivery-location-sheet">
      <div className="delivery-sheet-copy">
        <span className="section-kicker"><i className="location-status-dot" />{selectedPoint ? 'DELIVERY POINT SELECTED' : 'YOUR DELIVERY POINT'}</span>
        <h2>{selectedPoint?.label || 'Choose your exact doorstep'}</h2>
        <p>{precision || 'Your pin marks the exact entrance for this delivery.'}</p>
        {selectedPoint && <small className="delivery-coordinate-readout">LAT {selectedPoint.latitude.toFixed(7)} · LNG {selectedPoint.longitude.toFixed(7)}</small>}
        {routeInfo && <small className="delivery-route-info">{routeInfo}</small>}
      </div>
      <button className="primary-button delivery-confirm-button" type="button" disabled={!selectedPoint} onClick={confirmLocation}>Confirm delivery location</button>
    </div>
    <p className="delivery-map-message" role="status">{message}</p>
  </section>
}

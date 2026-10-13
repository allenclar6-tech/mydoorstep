import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const sapeleCenter = [5.6846, 5.8916]

export function LocationMap({ onSelect }) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [message, setMessage] = useState(token ? 'Drag, zoom, or tap the map to refine your delivery point.' : 'Map configuration is unavailable.')

  useEffect(() => {
    if (!token || !mapElement.current || mapRef.current) return undefined
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: mapElement.current,
      style: 'mapbox://styles/mapbox/standard',
      center: sapeleCenter,
      zoom: 12.5,
      pitch: 52,
      bearing: -18,
      antialias: true,
    })
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('style.load', () => {
      map.setConfigProperty?.('basemap', 'lightPreset', 'day')
      map.setConfigProperty?.('basemap', 'show3dObjects', true)
    })
    map.on('click', (event) => {
      const coordinates = [event.lngLat.lng, event.lngLat.lat]
      markerRef.current?.remove()
      markerRef.current = new mapboxgl.Marker({ color: '#ffc244', draggable: true }).setLngLat(coordinates).addTo(map)
      const savePoint = (point) => {
        setMessage(`Pinned delivery point · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`)
        onSelect({ latitude: point.lat, longitude: point.lng })
      }
      savePoint(event.lngLat)
      markerRef.current.on('dragend', () => savePoint(markerRef.current.getLngLat()))
    })
    mapRef.current = map
    return () => {
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  const useDeviceLocation = () => {
    if (!navigator.geolocation || !mapRef.current) {
      setMessage('Device location is unavailable in this browser.')
      return
    }
    setMessage('Locating your device…')
    navigator.geolocation.getCurrentPosition((position) => {
      const coordinates = [position.coords.longitude, position.coords.latitude]
      mapRef.current.flyTo({ center: coordinates, zoom: 16, pitch: 60, essential: true })
      markerRef.current?.remove()
      markerRef.current = new mapboxgl.Marker({ color: '#00a082', draggable: true }).setLngLat(coordinates).addTo(mapRef.current)
      onSelect({ latitude: position.coords.latitude, longitude: position.coords.longitude })
      setMessage('Device location set. Drag the marker if your door is elsewhere.')
    }, () => setMessage('Location permission was not granted. Choose an area or tap the map instead.'), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 })
  }

  return <section className="location-map-card">
    <div className="location-map-heading"><div><span className="section-kicker">LIVE DELIVERY MAP</span><h2>Pin your exact doorstep.</h2></div><button className="quiet-button" type="button" onClick={useDeviceLocation}>Use my location</button></div>
    <div className="location-map" ref={mapElement} aria-label="Interactive delivery location map" />
    <p>{message}</p>
  </section>
}

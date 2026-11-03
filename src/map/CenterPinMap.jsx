import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Home, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { areaForAddress } from '../../server/sapeleDirectory.js'
import { createDoorstepMap, defaultMapCenter, useMapToken } from './mapCore'
import { describeGeolocationError, getDevicePosition, resolveGooglePlace, reverseGeocode, searchAddresses } from './addressSearch'

// Glovo-style full-screen map: the pin stays in the middle and the map moves under it.
// Used for delivery addresses (shop/AddressEditor.jsx) and package pick-up / drop-off (parcel/RouteStep.jsx).

/**
 * start:      { latitude, longitude } to open on, or null (the person's area, or the middle of the covered states)
 * onConfirm:  ({ latitude, longitude, label, area }) when "Use this spot" is tapped
 * tone:       '' | 'a' | 'b' — pin colour (A = pick-up, B = drop-off)
 * places:     saved places shown as one-tap chips: [{ id, label, addressLine, latitude, longitude }]
 * footer:     extra buttons under the confirm button
 * onNoMap:    called if the map can't load (no Mapbox token)
 */
export function CenterPinMap({ start = null, onBack, onConfirm, onNoMap, kicker = 'Your pin', prompt = 'Put the pin on your gate', hint = 'Drag the map so the pin sits exactly on the entrance.', confirmLabel = 'Use this spot', tone = '', places = [], footer = null }) {
  const { token: mapToken, resolved } = useMapToken()
  const holder = useRef(null)
  const mapRef = useRef(null)
  const startPoint = useMemo(() => start, [])
  const [center, setCenter] = useState(startPoint || { latitude: defaultMapCenter()[1], longitude: defaultMapCenter()[0] })
  const [moving, setMoving] = useState(false)
  const [placeName, setPlaceName] = useState(startPoint?.label || '')
  const [looking, setLooking] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [note, setNote] = useState('')
  const [locating, setLocating] = useState(false)
  const [touched, setTouched] = useState(Boolean(startPoint))
  const named = useRef(Boolean(startPoint?.label))

  useEffect(() => { if (resolved && !mapToken) onNoMap?.() }, [resolved, mapToken])

  useEffect(() => {
    if (!mapToken || !holder.current || mapRef.current) return undefined
    const created = createDoorstepMap(holder.current, { center: [center.longitude, center.latitude], zoom: startPoint ? 17 : 14 })
    if (!created) return undefined
    const { map } = created
    mapRef.current = map
    map.on('dragstart', () => { setTouched(true); named.current = false })
    map.on('movestart', () => setMoving(true))
    map.on('moveend', () => { const next = map.getCenter(); setMoving(false); setCenter({ latitude: next.lat, longitude: next.lng }) })
    return () => { map.remove(); mapRef.current = null }
  }, [mapToken])

  // Name the street under the pin once the map stops (unless a saved place or search result already named it).
  useEffect(() => {
    if (moving || !touched || named.current) return undefined
    let active = true
    setLooking(true)
    const timer = setTimeout(() => reverseGeocode(center).then((label) => { if (active) setPlaceName(label || '') }).catch(() => { if (active) setPlaceName('') }).finally(() => { if (active) setLooking(false) }), 350)
    return () => { active = false; clearTimeout(timer) }
  }, [center.latitude, center.longitude, moving, touched])

  useEffect(() => {
    if (search.trim().length < 3) { setResults([]); return undefined }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => searchAddresses(search, { signal: controller.signal }).then((body) => setResults(body.results.slice(0, 6))).catch((searchError) => { if (searchError?.name !== 'AbortError') { setResults([]); setNote(searchError.message || 'Search isn’t working right now. Move the map instead.') } }).finally(() => setSearching(false)), 350)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [search])

  const flyTo = (latitude, longitude, zoom = 17.5) => { setTouched(true); mapRef.current?.flyTo({ center: [longitude, latitude], zoom, speed: 1.6 }) }
  const pickResult = async (result) => {
    setResults([]); setSearch(result.name)
    try {
      const coordinates = result.coordinates || (result.placeId ? (await resolveGooglePlace(result.placeId)).coordinates : null)
      if (coordinates) flyTo(coordinates[1], coordinates[0])
      setNote('Now move the map so the pin sits on the gate or entrance.')
    } catch { setNote('Couldn’t open that place. Try another result or move the map.') }
  }
  const pickPlace = (place) => {
    named.current = true
    setPlaceName(place.addressLine)
    setNote('')
    flyTo(place.latitude, place.longitude, 18)
  }
  const locate = async () => {
    setLocating(true); setNote('')
    named.current = false
    try {
      const position = await getDevicePosition()
      flyTo(position.coords.latitude, position.coords.longitude, 18)
      if (position.coords.accuracy > 60) setNote(`Your phone is only sure within about ${Math.round(position.coords.accuracy)} m. Check the pin is on the gate.`)
    } catch (locateError) { setNote(describeGeolocationError(locateError)) } finally { setLocating(false) }
  }
  const area = areaForAddress(placeName)
  const confirm = () => onConfirm({ latitude: Number(center.latitude.toFixed(7)), longitude: Number(center.longitude.toFixed(7)), label: placeName || (area ? `Pinned spot near ${area.name}` : 'Pinned spot on the map'), area })
  const usablePlaces = places.filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude)).slice(0, 4)

  return <div className={`pp-page${tone ? ` is-tone-${tone}` : ''}`}>
    <div className="pp-map" ref={holder} aria-label="Map. Move it to put the pin on the entrance." role="application" />
    <div className={`pp-pin${moving ? ' is-moving' : ''}`} aria-hidden="true"><span className="pp-pin-head">{tone ? <b>{tone.toUpperCase()}</b> : <i />}</span><span className="pp-pin-shadow" /></div>

    <header className="pp-top">
      <button type="button" className="pp-round" onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button>
      <label className="pp-search"><Search size={18} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search street, place or landmark" aria-label="Search" />{search && <button type="button" onClick={() => { setSearch(''); setResults([]) }} aria-label="Clear"><X size={16} /></button>}</label>
    </header>
    {(results.length > 0 || searching) && <ul className="pp-results">{searching && !results.length ? <li className="pp-results-note">Searching…</li> : results.map((result) => <li key={`${result.source}:${result.id}`}><button type="button" onClick={() => pickResult(result)}><MapPin size={16} aria-hidden="true" /><span><b>{result.name}</b><small>{result.label}</small></span></button></li>)}</ul>}

    <button type="button" className="pp-round pp-locate" onClick={locate} disabled={locating} aria-label="Use my location"><LocateFixed size={20} className={locating ? 'is-spinning' : ''} /></button>

    <section className="pp-card">
      {usablePlaces.length > 0 && <div className="pp-places" role="list" aria-label="Saved places">{usablePlaces.map((place) => <button key={place.id} type="button" role="listitem" onClick={() => pickPlace(place)}><Home size={15} aria-hidden="true" />{place.label}</button>)}</div>}
      <span className="pp-card-kicker">{touched ? kicker : 'Move the map'}</span>
      <h2>{!touched ? prompt : moving || looking ? 'Finding the street…' : placeName ? placeName.split(',').slice(0, 2).join(',') : 'Pinned spot'}</h2>
      <p>{touched && area ? `${area.name}, Sapele · ` : ''}{hint}</p>
      {note && <p className="pp-note" role="status">{note}</p>}
      <button type="button" className="sp-primary" disabled={!touched || moving} onClick={confirm}>{confirmLabel}</button>
      {footer}
    </section>
  </div>
}

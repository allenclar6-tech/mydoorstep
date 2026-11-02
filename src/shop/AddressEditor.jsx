import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Briefcase, Check, ChevronRight, Home, LocateFixed, MapPin, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { areaForAddress, isPlannableArea, SAPELE_DIRECTORY, searchDirectory } from '../../server/sapeleDirectory.js'
import { createDoorstepMap, SAPELE_CENTER, useMapToken } from '../map/mapCore'
import { describeGeolocationError, getDevicePosition, resolveGooglePlace, reverseGeocode, searchAddresses } from '../map/addressSearch'
import { EmptyState, Sheet, ShopHeader } from './ShopKit'
import { checkDelivery, chooseAddress, currentAddress, navigate, token } from './shopData'
import { toast } from './Toaster'

// Glovo-style addresses: type the address (area, street and house number, landmark), and add a map pin only if you
// want the exact delivery fee. Without a pin the fee is priced by the area. Screens: /address/new, /location, /account/addresses.

const AREAS = SAPELE_DIRECTORY.filter(isPlannableArea).sort((a, b) => a.name.localeCompare(b.name))
const DRAFT_KEY = 'doorstep-address-draft'
const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' })
const safeReturn = (value, fallback = '/') => (value && /^\/(?![/\\])/.test(value) ? value : fallback)
const params = () => new URLSearchParams(window.location.search)
const readDraft = () => { try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') } catch { return null } }
const writeDraft = (draft) => { try { if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); else sessionStorage.removeItem(DRAFT_KEY) } catch { /* private mode */ } }
const LABELS = [['Home', Home], ['Work', Briefcase], ['Other', MapPin]]

/** Builds the one-line address customers and riders read: "12 Boyo Road, Ayomanor Road district, Sapele". */
export function fullAddressLine(street, area) {
  const line = String(street || '').trim().replace(/\s+/g, ' ')
  if (!area) return line
  return line.toLowerCase().includes(area.name.toLowerCase()) ? line : `${line}, ${area.name}, Sapele`
}

function staticMapUrl(pin, mapToken, { width = 640, height = 240 } = {}) {
  if (!pin || !mapToken) return null
  const at = `${pin.longitude.toFixed(6)},${pin.latitude.toFixed(6)}`
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+123d2d(${at})/${at},16.5,0/${width}x${height}@2x?access_token=${encodeURIComponent(mapToken)}`
}

/** Picks a Sapele area from a searchable list. */
function AreaSheet({ value, onPick, onClose }) {
  const [query, setQuery] = useState('')
  const list = AREAS.filter((area) => `${area.name} ${area.postcode || ''} ${(area.streets || []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <Sheet title="Choose your area" onClose={onClose} className="ae-area-sheet">
    <label className="ae-search"><Search size={18} aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an area, street or postcode" aria-label="Search areas" /></label>
    <ul className="ae-area-list">{list.map((area) => <li key={area.id}><button type="button" className={value?.id === area.id ? 'is-selected' : ''} onClick={() => { onPick(area); onClose() }}>
      <span><b>{area.name}</b><small>{area.postcode ? `Sapele ${area.postcode}` : 'Sapele'}{area.streets?.length ? ` · ${area.streets.slice(0, 3).join(', ')}` : ''}</small></span>{value?.id === area.id && <Check size={18} aria-label="Selected" />}
    </button></li>)}</ul>
    {list.length === 0 && <p className="sp-note">No area matches “{query}”. Try the street name, or choose the closest area.</p>}
  </Sheet>
}

/** Street box with suggestions from the Sapele directory; picking one fills in the area too. */
function StreetInput({ value, onChange, onArea }) {
  const [open, setOpen] = useState(false)
  const typedStreet = String(value || '').replace(/^((?:no\.?|plot|house)\s*)?\d+[a-z]?\s*,?\s*/i, '')
  const results = useMemo(() => open && typedStreet.trim().length >= 2 ? searchDirectory(typedStreet, 5).filter((result) => result.type !== 'area') : [], [open, typedStreet])
  const pick = (result) => {
    const house = String(value || '').match(/^((?:no\.?|plot|house)\s*)?\d+[a-z]?\b/i)?.[0]
    onChange(`${house ? `${house} ` : ''}${result.name}`)
    const area = AREAS.find((entry) => entry.id === result.areaId)
    if (area) onArea(area)
    setOpen(false)
  }
  return <div className="ae-street">
    <input id="ae-street" required value={value} maxLength={160} autoComplete="street-address" placeholder="e.g. 12 Boyo Road"
      onChange={(event) => { onChange(event.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
    {results.length > 0 && <ul className="ae-suggest" role="listbox">{results.map((result) => <li key={`${result.name}-${result.areaId}`} role="option" aria-selected="false" onMouseDown={(event) => { event.preventDefault(); pick(result) }}>
      <MapPin size={16} aria-hidden="true" /><span><b>{result.name}</b><small>{result.areaName}</small></span>
    </li>)}</ul>}
  </div>
}

/** Add or edit an address by typing it. The map pin is optional. */
export function AddressEditorPage() {
  const query = params()
  const returnTo = safeReturn(query.get('return'), token() ? '/account/addresses' : '/')
  const editId = query.get('id')
  const signedIn = Boolean(token())
  const { token: mapToken } = useMapToken()
  const draft = useMemo(() => readDraft(), [])
  const [label, setLabel] = useState(draft?.label || 'Home')
  const [customLabel, setCustomLabel] = useState(draft?.customLabel || '')
  const [street, setStreet] = useState(draft?.street || '')
  const [area, setArea] = useState(() => AREAS.find((entry) => entry.id === draft?.areaId) || null)
  const [landmark, setLandmark] = useState(draft?.landmark || '')
  const [pin, setPin] = useState(draft?.pin || null)
  const [areaOpen, setAreaOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [check, setCheck] = useState(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const areaTouched = useRef(Boolean(draft?.areaId))

  // Editing a saved address: load it once (unless we came back from the map with a draft).
  useEffect(() => {
    if (!editId || draft?.id === editId || !signedIn) return
    fetch(`${apiBase}/api/addresses`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => {
      const saved = body?.addresses?.find((entry) => entry.id === editId)
      if (!saved) return
      const known = LABELS.some(([name]) => name === saved.label)
      setLabel(known ? saved.label : 'Other'); setCustomLabel(known ? '' : saved.label)
      const found = areaForAddress(saved.addressLine)
      const foundArea = found ? AREAS.find((entry) => entry.id === found.id) : null
      setArea(foundArea); areaTouched.current = Boolean(foundArea)
      setStreet(foundArea ? saved.addressLine.replace(new RegExp(`,?\\s*${foundArea.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'i'), '') : saved.addressLine)
      setLandmark(saved.landmark || '')
      if (saved.latitude != null && saved.longitude != null) setPin({ latitude: Number(saved.latitude), longitude: Number(saved.longitude) })
    }).catch(() => undefined)
  }, [editId])

  // Typing a known street fills in the area (until the person picks one themselves).
  useEffect(() => {
    if (areaTouched.current || street.trim().length < 3) return
    const found = areaForAddress(street)
    if (found) setArea(AREAS.find((entry) => entry.id === found.id) || null)
  }, [street])

  const line = fullAddressLine(street, area)
  useEffect(() => {
    if (street.trim().length < 3 || !area) { setCheck(null); return undefined }
    let active = true
    const timer = setTimeout(() => checkDelivery({ point: pin, label: line }).then((body) => { if (active) setCheck(body) }).catch(() => undefined), 400)
    return () => { active = false; clearTimeout(timer) }
  }, [line, pin?.latitude, pin?.longitude])

  const snapshot = () => ({ id: editId, label, customLabel, street, areaId: area?.id || null, landmark, pin })
  const openMap = () => { writeDraft(snapshot()); navigate(`/location?draft=1&return=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`) }
  const finalLabel = label === 'Other' ? (customLabel.trim() || 'Other') : label

  const save = async (event) => {
    event.preventDefault()
    setError('')
    if (street.trim().length < 3) { setError('Type your street and house number.'); return }
    if (!area) { setError('Choose your area so we can work out the delivery fee.'); setAreaOpen(true); return }
    setSaving(true)
    let savedId = editId || null
    try {
      if (signedIn) {
        const body = { label: finalLabel.slice(0, 40), addressLine: line.slice(0, 240), landmark: landmark.trim().slice(0, 200), ...(pin ? { latitude: Number(pin.latitude.toFixed(7)), longitude: Number(pin.longitude.toFixed(7)) } : editId ? { clearPin: true } : {}) }
        const response = await fetch(`${apiBase}/api/addresses${editId ? `/${editId}` : ''}`, { method: editId ? 'PATCH' : 'POST', headers: authHeaders(), body: JSON.stringify(body) })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(response.status === 401 ? 'You’ve been signed out. Sign in again to save addresses.' : 'Couldn’t save this address. Check it and try again.')
        savedId = result.address?.id || savedId
      }
      chooseAddress({ label: line, latitude: pin?.latitude, longitude: pin?.longitude, savedAddressId: savedId, landmark: landmark.trim() || null })
      writeDraft(null)
      toast(signedIn ? 'Address saved' : 'Delivering to this address')
      navigate(returnTo)
    } catch (saveError) { setError(saveError instanceof TypeError ? 'No internet. Try again when you’re back online.' : saveError.message) } finally { setSaving(false) }
  }

  const preview = staticMapUrl(pin, mapToken)
  return <div className="sp-screen ae-page">
    <ShopHeader title={editId ? 'Edit address' : 'Add an address'} back={returnTo} />
    <form className="sp-body ae-form" onSubmit={save} noValidate>
      <p className="ae-intro">Type your address the way you’d tell a rider. A map pin is optional.</p>

      <fieldset className="ae-labels"><legend>Save it as</legend>
        {LABELS.map(([name, Icon]) => <button key={name} type="button" className={label === name ? 'is-on' : ''} aria-pressed={label === name} onClick={() => setLabel(name)}><Icon size={17} aria-hidden="true" />{name}</button>)}
      </fieldset>
      {label === 'Other' && <label className="ae-field"><span>Name this place</span><input value={customLabel} maxLength={40} onChange={(event) => setCustomLabel(event.target.value)} placeholder="e.g. Mum’s house, Shop" /></label>}

      <div className="ae-field"><label htmlFor="ae-street">Street and house number</label><StreetInput value={street} onChange={setStreet} onArea={(next) => { areaTouched.current = true; setArea(next) }} /></div>

      <div className="ae-field"><span id="ae-area-label">Area in Sapele</span>
        <button type="button" className={`ae-select${area ? '' : ' is-empty'}`} aria-labelledby="ae-area-label" onClick={() => setAreaOpen(true)}>
          <MapPin size={18} aria-hidden="true" /><span>{area ? <><b>{area.name}</b>{area.postcode && <small>Sapele {area.postcode}</small>}</> : 'Choose your area'}</span><ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      <label className="ae-field"><span>Landmark and directions <em>(helps your rider)</em></span>
        <textarea rows={2} value={landmark} maxLength={200} onChange={(event) => setLandmark(event.target.value)} placeholder="e.g. Blue gate opposite Total filling station, 2nd floor" />
        <small className="ae-count">{landmark.length}/200</small>
      </label>

      <section className={`ae-pin${pin ? ' has-pin' : ''}`} aria-label="Map pin">
        {pin ? <>
          {preview && !previewFailed ? <img src={preview} alt="Your pin on the map" className="ae-pin-map" loading="lazy" onError={() => setPreviewFailed(true)} /> : <div className="ae-pin-map is-plain"><MapPin size={28} aria-hidden="true" /><small>{pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}</small></div>}
          <div className="ae-pin-row"><span><b><Check size={16} aria-hidden="true" />Pin added</b><small>You’ll get the exact delivery fee for this spot.</small></span>
            <button type="button" className="sp-ghost" onClick={openMap}>Move pin</button>
            <button type="button" className="ae-icon" onClick={() => setPin(null)} aria-label="Remove pin"><X size={18} /></button></div>
        </> : <button type="button" className="ae-pin-add" onClick={openMap}>
          <span className="ae-pin-icon" aria-hidden="true"><MapPin size={20} /></span>
          <span><b>Add a map pin <em>optional</em></b><small>Get the exact delivery fee and help riders find your gate.</small></span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>}
      </section>

      {check && <p className={`ae-check${check.deliverable === false ? ' is-out' : ''}`} role="status">{check.deliverable === false ? check.message : pin ? `✓ ${check.message}` : `✓ ${check.message || 'DOORSTEP delivers here.'} The fee is priced by your area until you add a pin.`}</p>}
      {error && <p className="ae-error" role="alert">{error}</p>}
      {!signedIn && <p className="sp-note">You’re not signed in, so this address is used on this phone only. <a href="/login" onClick={(event) => { event.preventDefault(); navigate('/login') }}>Sign in</a> to keep it.</p>}

      <div className="ae-save"><button type="submit" className="sp-primary" disabled={saving}>{saving ? 'Saving…' : signedIn ? (editId ? 'Save changes' : 'Save address') : 'Use this address'}</button></div>
    </form>
    {areaOpen && <AreaSheet value={area} onPick={(next) => { areaTouched.current = true; setArea(next) }} onClose={() => setAreaOpen(false)} />}
  </div>
}

/** Full-screen map: the pin stays in the middle and you move the map under it (like Glovo). */
export function PinPickerPage() {
  const query = params()
  const draftMode = query.get('draft') === '1'
  const returnTo = safeReturn(query.get('return'), '')
  const { token: mapToken, resolved } = useMapToken()
  const holder = useRef(null)
  const mapRef = useRef(null)
  const start = useMemo(() => { const draft = draftMode ? readDraft() : null; return draft?.pin || currentAddress().point || null }, [])
  const [center, setCenter] = useState(start || { latitude: SAPELE_CENTER[1], longitude: SAPELE_CENTER[0] })
  const [moving, setMoving] = useState(false)
  const [placeName, setPlaceName] = useState('')
  const [looking, setLooking] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [note, setNote] = useState('')
  const [locating, setLocating] = useState(false)
  const [touched, setTouched] = useState(Boolean(start))

  useEffect(() => {
    if (!mapToken || !holder.current || mapRef.current) return undefined
    const created = createDoorstepMap(holder.current, { center: [center.longitude, center.latitude], zoom: start ? 17 : 14 })
    if (!created) return undefined
    const { map } = created
    mapRef.current = map
    map.on('dragstart', () => setTouched(true))
    map.on('movestart', () => setMoving(true))
    map.on('moveend', () => { const next = map.getCenter(); setMoving(false); setCenter({ latitude: next.lat, longitude: next.lng }) })
    return () => { map.remove(); mapRef.current = null }
  }, [mapToken])

  // Name the street under the pin once the map stops.
  useEffect(() => {
    if (moving || !touched) return undefined
    let active = true
    setLooking(true)
    const timer = setTimeout(() => reverseGeocode(center).then((label) => { if (active) setPlaceName(label || '') }).catch(() => { if (active) setPlaceName('') }).finally(() => { if (active) setLooking(false) }), 350)
    return () => { active = false; clearTimeout(timer) }
  }, [center.latitude, center.longitude, moving, touched])

  // Search as you type (directory streets and real places).
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
      setNote('Now move the map so the pin sits on your gate or entrance.')
    } catch { setNote('Couldn’t open that place. Try another result or move the map.') }
  }
  const locate = async () => {
    setLocating(true); setNote('')
    try {
      const position = await getDevicePosition()
      flyTo(position.coords.latitude, position.coords.longitude, 18)
      if (position.coords.accuracy > 60) setNote(`Your phone is only sure within about ${Math.round(position.coords.accuracy)} m. Check the pin is on your gate.`)
    } catch (locateError) { setNote(describeGeolocationError(locateError)) } finally { setLocating(false) }
  }
  const area = areaForAddress(placeName)
  const confirm = () => {
    const pin = { latitude: Number(center.latitude.toFixed(7)), longitude: Number(center.longitude.toFixed(7)) }
    if (draftMode) {
      const draft = readDraft() || {}
      const next = { ...draft, pin }
      // Fill empty fields from the map, but never overwrite what the person typed.
      if (!draft.street && placeName) next.street = placeName.split(',')[0]
      if (!draft.areaId && area) next.areaId = area.id
      writeDraft(next)
      navigate(returnTo || '/address/new')
      return
    }
    if (returnTo) {
      const current = currentAddress()
      chooseAddress({ label: placeName || current.label || 'Pinned location', latitude: pin.latitude, longitude: pin.longitude, landmark: current.landmark || null })
      toast('Pin saved')
      navigate(returnTo)
      return
    }
    // From the address sheet: pin first, then the details riders need.
    writeDraft({ label: 'Home', street: placeName ? placeName.split(',')[0] : '', areaId: area?.id || null, landmark: '', pin })
    navigate('/address/new')
  }
  const typeInstead = () => {
    if (!draftMode) writeDraft(null)
    navigate(draftMode ? (returnTo || '/address/new') : `/address/new${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ''}`)
  }

  if (resolved && !mapToken) return <div className="sp-screen ae-page"><ShopHeader title="Map" back={returnTo || '/'} />
    <main className="sp-body"><EmptyState icon={MapPin} title="The map isn’t available right now" body="No problem — type your address instead. The delivery fee will be priced by your area." action={<button type="button" className="sp-primary" onClick={typeInstead}>Type my address</button>} /></main></div>

  return <div className="pp-page">
    <div className="pp-map" ref={holder} aria-label="Map. Move it to put the pin on your gate." role="application" />
    <div className={`pp-pin${moving ? ' is-moving' : ''}`} aria-hidden="true"><span className="pp-pin-head"><i /></span><span className="pp-pin-shadow" /></div>

    <header className="pp-top">
      <button type="button" className="pp-round" onClick={() => navigate(returnTo || (draftMode ? '/address/new' : '/'))} aria-label="Back"><ArrowLeft size={20} /></button>
      <label className="pp-search"><Search size={18} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search street, place or landmark" aria-label="Search" />{search && <button type="button" onClick={() => { setSearch(''); setResults([]) }} aria-label="Clear"><X size={16} /></button>}</label>
    </header>
    {(results.length > 0 || searching) && <ul className="pp-results">{searching && !results.length ? <li className="pp-results-note">Searching…</li> : results.map((result) => <li key={`${result.source}:${result.id}`}><button type="button" onClick={() => pickResult(result)}><MapPin size={16} aria-hidden="true" /><span><b>{result.name}</b><small>{result.label}</small></span></button></li>)}</ul>}

    <button type="button" className="pp-round pp-locate" onClick={locate} disabled={locating} aria-label="Use my location"><LocateFixed size={20} className={locating ? 'is-spinning' : ''} /></button>

    <section className="pp-card">
      <span className="pp-card-kicker">{touched ? 'Your pin' : 'Move the map'}</span>
      <h2>{!touched ? 'Put the pin on your gate' : moving ? 'Finding the street…' : looking ? 'Finding the street…' : placeName ? placeName.split(',').slice(0, 2).join(',') : 'Pinned spot'}</h2>
      <p>{touched && area ? `${area.name}, Sapele · ` : ''}Drag the map so the pin sits exactly on your entrance.</p>
      {note && <p className="pp-note" role="status">{note}</p>}
      <button type="button" className="sp-primary" disabled={!touched || moving} onClick={confirm}>Use this spot</button>
      <button type="button" className="pp-type" onClick={typeInstead}><Pencil size={15} aria-hidden="true" />Type my address instead</button>
    </section>
  </div>
}

/** Saved addresses: use one, edit it, add a pin, or delete it. */
export function AddressBookPage() {
  const signedIn = Boolean(token())
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const current = currentAddress()
  const load = () => fetch(`${apiBase}/api/addresses`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : Promise.reject(new Error())).then((body) => { setList(body.addresses || []); setError('') }).catch(() => setError('Couldn’t load your addresses. Check your internet.'))
  useEffect(() => { if (signedIn) load() }, [])
  const use = (entry) => {
    chooseAddress({ label: entry.addressLine, latitude: entry.latitude == null ? NaN : Number(entry.latitude), longitude: entry.longitude == null ? NaN : Number(entry.longitude), savedAddressId: entry.id, landmark: entry.landmark || null })
    toast(`Delivering to ${entry.label}`)
    navigate('/')
  }
  const remove = async (entry) => {
    setConfirmDelete(null)
    const response = await fetch(`${apiBase}/api/addresses/${entry.id}`, { method: 'DELETE', headers: authHeaders() }).catch(() => null)
    if (response?.ok) { toast('Address deleted'); load() } else setError('Couldn’t delete it. Try again.')
  }
  const add = () => { writeDraft(null); navigate('/address/new?return=/account/addresses') }
  const iconFor = (labelText) => labelText === 'Home' ? Home : labelText === 'Work' ? Briefcase : MapPin

  return <div className="sp-screen ae-page">
    <ShopHeader title="My addresses" back="/profile" />
    <main className="sp-body ae-book">
      {!signedIn ? <EmptyState icon={MapPin} title="Sign in to save addresses" body="You can still type an address for this order." action={<div className="ae-row-actions"><button type="button" className="sp-primary" onClick={() => navigate('/login')}>Sign in</button><button type="button" className="sp-ghost" onClick={add}>Type an address</button></div>} />
        : <>
          {error && <p className="ae-error" role="alert">{error}</p>}
          {list === null && !error && <div className="sp-skeletons"><div className="sp-skeleton" /><div className="sp-skeleton" /></div>}
          {list?.length === 0 && <EmptyState icon={Home} title="No saved addresses yet" body="Save Home, Work and other places so ordering is one tap." />}
          {list?.length > 0 && <ul className="ae-list">{list.map((entry) => {
            const Icon = iconFor(entry.label)
            const pinned = entry.latitude != null && entry.longitude != null
            const inUse = current.savedAddressId === entry.id
            return <li key={entry.id} className={inUse ? 'is-current' : ''}>
              <button type="button" className="ae-list-main" onClick={() => use(entry)}>
                <span className="ae-list-icon" aria-hidden="true"><Icon size={19} /></span>
                <span><b>{entry.label}{inUse && <em>In use</em>}</b><small>{entry.addressLine}</small>{entry.landmark && <small className="ae-landmark">{entry.landmark}</small>}
                  <i className={`ae-chip${pinned ? ' is-on' : ''}`}>{pinned ? 'Pinned on map' : 'No pin · priced by area'}</i></span>
              </button>
              <div className="ae-list-actions">
                <button type="button" className="ae-icon" onClick={() => { writeDraft(null); navigate(`/address/new?id=${entry.id}&return=/account/addresses`) }} aria-label={`Edit ${entry.label}`}><Pencil size={17} /></button>
                <button type="button" className="ae-icon is-danger" onClick={() => setConfirmDelete(entry)} aria-label={`Delete ${entry.label}`}><Trash2 size={17} /></button>
              </div>
            </li>
          })}</ul>}
          <button type="button" className="sp-add-address ae-add" onClick={add}><Plus size={18} aria-hidden="true" />Add a new address</button>
        </>}
    </main>
    {confirmDelete && <Sheet title="Delete this address?" onClose={() => setConfirmDelete(null)}>
      <p className="sp-note">{confirmDelete.label}: {confirmDelete.addressLine}</p>
      <div className="ae-row-actions"><button type="button" className="sp-primary is-danger" onClick={() => remove(confirmDelete)}>Delete</button><button type="button" className="sp-ghost" onClick={() => setConfirmDelete(null)}>Keep it</button></div>
    </Sheet>}
  </div>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Bike, Bookmark, Car, Check, ChevronRight, Compass, Footprints, LocateFixed, MapPin, Navigation, Plus, RotateCcw, Settings2, Share2, Square, X } from 'lucide-react'
import GoogleNavigationMap from './GoogleNavigationMap'
import MapboxNavigationMap from './MapboxNavigationMap'
import PlaceSearch from './PlaceSearch'
import { navigationProvider, navigationProviderName, navigationRequest, routePoint } from './api'
import { arrivalTime, distanceBetween, emptyPreferences, formatDistance, formatDuration, gpsErrorMessage, navigationProgress, parseSharedPlan, prepareRoute, routeColors, sharePlanUrl, validPoint } from './navigation'
import './navigation.css'

const savedKey = 'doorstep-navigation-destinations'
const modes = [{ value: 'DRIVE', label: 'Drive', icon: Car }, { value: 'WALK', label: 'Walk', icon: Footprints }, { value: 'BICYCLE', label: 'Cycle', icon: Bike }]
const gpsOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
const NavigationMap = navigationProvider === 'google' ? GoogleNavigationMap : MapboxNavigationMap

function loadInitialPlan() {
  try {
    return { plan: parseSharedPlan(window.location.search), error: '' }
  } catch {
    return { plan: null, error: 'This shared route is invalid. Choose a new start and destination.' }
  }
}

function loadSaved() {
  try {
    const stored = JSON.parse(localStorage.getItem(savedKey) || '[]')
    if (!Array.isArray(stored)) throw new Error('Invalid saved destinations')
    return { places: stored.filter((point) => validPoint(point) && typeof point.label === 'string').slice(0, 20), error: '' }
  } catch {
    return { places: [], error: 'Saved destinations could not be read from this browser. Saving again will replace the invalid list.' }
  }
}

export default function NavigationPage() {
  const [initial] = useState(loadInitialPlan)
  const [savedInitial] = useState(loadSaved)
  const [origin, setOrigin] = useState(initial.plan?.origin || null)
  const [stops, setStops] = useState(initial.plan?.stops || [null])
  const [mode, setMode] = useState(initial.plan?.mode || 'DRIVE')
  const [preferences, setPreferences] = useState(initial.plan?.preferences || emptyPreferences)
  const [routes, setRoutes] = useState([])
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initial.error || savedInitial.error)
  const [notice, setNotice] = useState('')
  const [position, setPosition] = useState(null)
  const [locating, setLocating] = useState(false)
  const [active, setActive] = useState(false)
  const [following, setFollowing] = useState(false)
  const [progress, setProgress] = useState(null)
  const [overviewKey, setOverviewKey] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [saved, setSaved] = useState(savedInitial.places)
  const [pickTarget, setPickTarget] = useState(null)
  const [mapReady, setMapReady] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [expanded, setExpanded] = useState(true)
  const [gpsStale, setGpsStale] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const workspaceRef = useRef(null)
  const panelRef = useRef(null)
  const requestRef = useRef(null)
  const requestVersion = useRef(0)
  const gpsWatch = useRef(null)
  const mounted = useRef(false)
  const singleGpsVersion = useRef(0)
  const navigationRef = useRef(null)
  const progressRef = useRef(0)
  const lastFix = useRef(0)
  const lastReroute = useRef(0)
  const offRouteCount = useRef(0)
  const reachedStops = useRef(0)
  const reroutingRef = useRef(false)
  const reroutedPlanRef = useRef(false)
  const route = routes[selected]
  navigationRef.current = { active, route, stops, mode, preferences }

  const stopNavigation = useCallback(() => {
    if (navigationRef.current) navigationRef.current.active = false
    requestRef.current?.abort()
    ++requestVersion.current
    reroutingRef.current = false
    setBusy(false)
    if (gpsWatch.current != null) navigator.geolocation?.clearWatch(gpsWatch.current)
    gpsWatch.current = null
    setActive(false)
    setFollowing(false)
    setProgress(null)
    setGpsStale(false)
    progressRef.current = 0
    offRouteCount.current = 0
  }, [])

  useEffect(() => {
    mounted.current = true
    const onOnline = () => setOnline(true)
    const onOffline = () => { setOnline(false); setNotice('Connection lost. Loaded guidance remains visible; new maps and routes need a connection.') }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      mounted.current = false
      requestRef.current?.abort()
      if (gpsWatch.current != null) navigator.geolocation?.clearWatch(gpsWatch.current)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      workspaceRef.current?.style.setProperty('--nav-panel-height', `${entry.borderBoxSize?.[0]?.blockSize || entry.target.getBoundingClientRect().height}px`)
    })
    observer.observe(panelRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => {
      setClock(Date.now())
      setGpsStale(Date.now() - lastFix.current > 20000)
    }, 5000)
    return () => clearInterval(timer)
  }, [active])

  const calculate = useCallback(async (start, destinations, travelMode, settings, rerouting = false) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const version = ++requestVersion.current
    reroutingRef.current = rerouting
    setBusy(true)
    setError('')
    try {
      if (!navigator.onLine) throw new Error('You are offline. Reconnect to calculate a real route.')
      const data = await navigationRequest('/routes', {
        signal: controller.signal,
        body: {
          origin: routePoint(start), destination: routePoint(destinations.at(-1)),
          intermediates: destinations.slice(0, -1).map(routePoint),
          travelMode, preferences: travelMode === 'DRIVE' ? settings : emptyPreferences,
        },
      })
      const prepared = data.routes.map(prepareRoute)
      if (version !== requestVersion.current || controller.signal.aborted || !mounted.current) return false
      if (rerouting) {
        reroutedPlanRef.current = true
        reachedStops.current = 0
        setOrigin({ ...routePoint(start), label: 'Your current GPS location' })
        setStops(destinations)
      }
      setRoutes(prepared)
      setSelected(0)
      setProgress(null)
      progressRef.current = 0
      offRouteCount.current = 0
      setNotice(rerouting ? 'Route recalculated from your current GPS location.' : '')
      return true
    } catch (failure) {
      if (version === requestVersion.current && !controller.signal.aborted && mounted.current) {
        setError(failure.message)
        if (rerouting) stopNavigation()
      }
      return false
    } finally {
      if (version === requestVersion.current && mounted.current) { setBusy(false); reroutingRef.current = false }
    }
  }, [stopNavigation])

  useEffect(() => {
    // A GPS reroute already has fresh routes; preserve its active location watch.
    if (reroutedPlanRef.current) { reroutedPlanRef.current = false; return undefined }
    stopNavigation()
    requestRef.current?.abort()
    ++requestVersion.current
    setRoutes([])
    setSelected(0)
    setBusy(false)
    reachedStops.current = 0
    if (!origin || stops.some((point) => !point)) return undefined
    const timer = setTimeout(() => calculate(origin, stops, mode, preferences), 450)
    return () => { clearTimeout(timer); requestRef.current?.abort() }
  }, [origin, stops, mode, preferences, calculate, stopNavigation])

  function updateStop(index, point) {
    setStops((current) => current.map((existing, i) => i === index ? point : existing))
  }

  function moveStop(index, direction) {
    setStops((current) => {
      const next = [...current]
      ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
      return next
    })
  }

  function useGps() {
    if (!navigator.geolocation || !window.isSecureContext) {
      setError('GPS requires HTTPS and a browser with location support. Choose a start point manually.')
      return
    }
    const version = ++singleGpsVersion.current
    setLocating(true)
    setError('')
    navigator.geolocation.getCurrentPosition((fix) => {
      if (!mounted.current || version !== singleGpsVersion.current) return
      setLocating(false)
      const point = gpsPoint(fix)
      setPosition(point)
      setOrigin({ ...routePoint(point), label: 'Your current location' })
      setNotice(`GPS accuracy: about ${Math.round(point.accuracy)} m. Check your blue dot before starting.`)
    }, (failure) => {
      if (!mounted.current || version !== singleGpsVersion.current) return
      setLocating(false)
      setError(gpsErrorMessage(failure))
    }, gpsOptions)
  }

  function gpsPoint(fix) {
    return {
      latitude: fix.coords.latitude, longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy,
      heading: Number.isFinite(fix.coords.heading) ? fix.coords.heading : null,
      timestamp: fix.timestamp,
    }
  }

  function startNavigation() {
    if (!route || busy) return
    if (!navigator.geolocation || !window.isSecureContext) { setError('Live navigation requires HTTPS and browser GPS support.'); return }
    if (!navigator.onLine) { setError('Reconnect before starting navigation.'); return }
    setError('')
    setNotice('Allow location access to start live navigation. Keep this page open; background GPS is not guaranteed by browsers.')
    lastFix.current = Date.now()
    lastReroute.current = 0
    offRouteCount.current = 0
    reachedStops.current = 0
    progressRef.current = 0
    setActive(true)
    setFollowing(true)
    setExpanded(false)
    navigationRef.current = { ...navigationRef.current, active: true }
    gpsWatch.current = navigator.geolocation.watchPosition((fix) => {
      if (!mounted.current || !navigationRef.current.active) return
      const current = gpsPoint(fix)
      if (!validPoint(current) || !Number.isFinite(current.accuracy) || current.accuracy < 0 || Date.now() - current.timestamp > 20000) return
      lastFix.current = Date.now()
      setGpsStale(false)
      setPosition(current)
      if (current.accuracy > 100) { setNotice(`GPS accuracy is low (about ${Math.round(current.accuracy)} m). Automatic rerouting is paused.`); return }
      const state = navigationRef.current
      if (!state.route) return
      const next = navigationProgress(state.route, current, progressRef.current)
      const onRoute = next.offRouteMeters <= Math.max(45, current.accuracy * 1.5)
      if (onRoute) {
        progressRef.current = next.along
        setProgress(next)
        setNotice('')
        offRouteCount.current = 0
        if (next.step) reachedStops.current = Math.max(reachedStops.current, next.step.legIndex)
        while (reachedStops.current < state.stops.length - 1 && distanceBetween(current, state.stops[reachedStops.current]) < 40) reachedStops.current += 1
        if (reachedStops.current === state.stops.length - 1 && next.remainingMeters < 60 && distanceBetween(current, state.stops.at(-1)) <= 35 && current.accuracy <= 40) {
          stopNavigation()
          navigationRef.current.active = false
          setNotice('You have arrived near your destination. Check your surroundings and exact entrance.')
          setExpanded(true)
        }
      } else {
        offRouteCount.current += 1
        setNotice('You appear to be off route. Checking your GPS before recalculating.')
        if (offRouteCount.current >= 2 && Date.now() - lastReroute.current > 20000 && !reroutingRef.current) {
          lastReroute.current = Date.now()
          if (!navigator.onLine) { setNotice('You are off route and offline. Reconnect to calculate new directions.'); return }
          const remainingStops = state.stops.slice(reachedStops.current)
          calculate(current, remainingStops, state.mode, state.preferences, true)
        }
      }
    }, (failure) => {
      if (!mounted.current || !navigationRef.current.active) return
      setError(gpsErrorMessage(failure))
      if (failure.code === 1) {
        navigationRef.current.active = false
        stopNavigation()
        setExpanded(true)
      } else setGpsStale(true)
    }, gpsOptions)
  }

  function closeDirections() {
    stopNavigation()
    navigationRef.current.active = false
    requestRef.current?.abort()
    ++requestVersion.current
    ++singleGpsVersion.current
    setLocating(false)
    setOrigin(null)
    setStops([null])
    setRoutes([])
    setNotice('Directions closed. Choose a new destination to plan another trip.')
    setError('')
    setPickTarget(null)
    setExpanded(true)
    window.history.replaceState({}, '', '/navigate')
  }

  async function shareRoute() {
    if (!origin || stops.some((point) => !point)) { setError('Choose a start and all destinations before sharing.'); return }
    const url = sharePlanUrl(origin, stops, mode, window.location.origin, preferences)
    if (!window.confirm('This link includes your start point and every destination. Share these locations?')) return
    try {
      if (navigator.share) await navigator.share({ title: 'DOORSTEP directions', url })
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); setNotice('Route link copied. Anyone with the link can see its locations.') }
      else { setNotice(`Copy this route link: ${url}`) }
    } catch (failure) {
      if (failure.name !== 'AbortError') setError('The route could not be shared. Check browser sharing or clipboard permissions.')
    }
  }

  function saveDestination() {
    const destination = stops.at(-1)
    if (!destination) { setError('Choose a destination before saving.'); return }
    try {
      const next = [destination, ...saved.filter((point) => distanceBetween(point, destination) > 5)].slice(0, 20)
      localStorage.setItem(savedKey, JSON.stringify(next))
      setSaved(next)
      setNotice('Destination saved on this device.')
    } catch { setError('This browser could not save the destination. Check available storage or private-browsing settings.') }
  }

  function removeSaved(index) {
    try {
      const next = saved.filter((_point, i) => i !== index)
      localStorage.setItem(savedKey, JSON.stringify(next))
      setSaved(next)
    } catch { setError('This browser could not remove the saved destination.') }
  }

  function pickPoint(point) {
    if (pickTarget == null || active) return false
    const selectedPoint = { latitude: point.latitude, longitude: point.longitude, label: `Map pin (${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)})` }
    if (pickTarget === 'origin') setOrigin(selectedPoint)
    else updateStop(pickTarget, selectedPoint)
    setPickTarget(null)
    setNotice('Map point selected. Verify the exact access road before travelling.')
    return true
  }

  const remainingSeconds = progress?.remainingSeconds ?? route?.durationSeconds
  const remainingMeters = progress?.remainingMeters ?? route?.distanceMeters
  const actionsDisabled = active || busy

  return <main ref={workspaceRef} className={`navigation-workspace${active ? ' is-navigating' : ''}`} aria-label="DOORSTEP maps and navigation">
    <NavigationMap origin={origin} stops={stops} routes={routes} selectedRoute={selected} position={position}
      following={following} overviewKey={overviewKey} onSelectRoute={(index) => { if (!active) setSelected(index) }}
      onPick={pickPoint} onReady={setMapReady} />
    <div className="nav-map-toolbar">
      <a href="/location" className="nav-back-link"><MapPin size={17} /> Delivery location</a>
      <button type="button" onClick={() => { setFollowing(false); setOverviewKey((value) => value + 1) }}><Compass size={18} /> Overview</button>
      {active && <button type="button" aria-pressed={following} onClick={() => setFollowing((value) => !value)}><LocateFixed size={18} />{following ? 'Explore map' : 'Follow me'}</button>}
    </div>
    {pickTarget != null && <div className="nav-pick-banner" role="status">Tap the map to choose {pickTarget === 'origin' ? 'your start' : 'this stop'}.<button type="button" onClick={() => setPickTarget(null)}>Cancel</button></div>}
    {active && <section className="nav-turn-card" aria-label="Live navigation instruction">
      <Navigation size={30} aria-hidden="true" />
      <div><strong>{gpsStale ? 'Waiting for GPS' : progress ? `In ${formatDistance(progress.nextTurnMeters)}` : 'Locating you...'}</strong>
        <p>{gpsStale ? 'Guidance may be out of date. Check your device location signal.' : progress?.step?.instruction || 'Follow road signs and obey local traffic rules.'}</p></div>
    </section>}
    <section ref={panelRef} className={`nav-planner${expanded ? ' is-expanded' : ''}`} aria-labelledby="nav-planner-title">
      <div className="nav-planner-heading">
        <div><span className="nav-eyebrow">DOORSTEP MAPS</span><h1 id="nav-planner-title">{active ? 'On your way' : 'Find your way.'}</h1></div>
        <button type="button" className="nav-round-button nav-mobile-expand" aria-expanded={expanded} aria-controls="nav-planner-content" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Collapse route panel' : 'Expand route panel'}><ChevronRight size={21} /></button>
        <button type="button" className="nav-round-button" onClick={closeDirections} aria-label="Close directions"><X size={20} /></button>
      </div>
      {!online && <div className="nav-alert" role="alert">Offline. Reconnect for new routes and map data.</div>}
      {error && <div className="nav-alert" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss navigation error"><X size={15} /></button></div>}
      {notice && <p className="nav-notice" role="status">{notice}</p>}
      {route && <div className="nav-trip-summary" data-clock={clock}>
        <strong>{formatDuration(remainingSeconds)}</strong><span>{formatDistance(remainingMeters)}<br />Arrival {arrivalTime(remainingSeconds)}</span>
        {active && <span className={gpsStale ? 'nav-gps-state is-stale' : 'nav-gps-state'}>{gpsStale ? 'GPS lost' : position ? `GPS +/-${Math.round(position.accuracy)} m` : 'Acquiring GPS'}</span>}
      </div>}
      <div id="nav-planner-content" className="nav-planner-content">
        <div className="nav-mode-tabs" role="group" aria-label="Travel mode">{modes.map(({ value, label, icon: Icon }) =>
          <button key={value} type="button" aria-pressed={mode === value} disabled={active} onClick={() => setMode(value)}><Icon size={19} />{label}</button>)}</div>
        {!active && <>
          <div className="nav-waypoint-row">
            <span className="nav-waypoint-symbol is-origin" aria-hidden="true" />
            <PlaceSearch label="Starting point" value={origin} onSelect={setOrigin} />
            <button type="button" className="nav-round-button" disabled={!mapReady} aria-pressed={pickTarget === 'origin'} onClick={() => setPickTarget('origin')} aria-label="Choose start on map"><MapPin size={18} /></button>
          </div>
          <button className="nav-location-action" type="button" onClick={useGps} disabled={locating}><LocateFixed size={16} />{locating ? 'Finding your GPS position...' : 'Use my current location'}</button>
          <div className="nav-stops">{stops.map((point, index) => <div className="nav-stop-block" key={index}>
            <div className="nav-waypoint-row">
              <span className="nav-waypoint-symbol is-destination" aria-hidden="true">{index + 1}</span>
              <PlaceSearch label={index === stops.length - 1 ? 'Destination' : `Stop ${index + 1}`} value={point} onSelect={(value) => updateStop(index, value)} />
              <button type="button" className="nav-round-button" disabled={!mapReady} aria-pressed={pickTarget === index} onClick={() => setPickTarget(index)} aria-label={`Choose stop ${index + 1} on map`}><MapPin size={18} /></button>
            </div>
            {stops.length > 1 && <div className="nav-stop-actions">
              <button type="button" disabled={index === 0} onClick={() => moveStop(index, -1)} aria-label={`Move stop ${index + 1} up`}><ArrowUp size={14} />Up</button>
              <button type="button" disabled={index === stops.length - 1} onClick={() => moveStop(index, 1)} aria-label={`Move stop ${index + 1} down`}><ArrowDown size={14} />Down</button>
              <button type="button" onClick={() => { setPickTarget(null); setStops((current) => current.filter((_value, i) => i !== index)) }} aria-label={`Remove stop ${index + 1}`}><X size={14} />Remove</button>
            </div>}
          </div>)}</div>
        </>}
        {showSettings && <fieldset className="nav-settings"><legend>Driving preferences</legend>
          {Object.entries({ avoidTolls: 'Avoid toll roads', avoidHighways: 'Avoid highways', avoidFerries: 'Avoid ferries' }).map(([key, label]) =>
            <label key={key}><input type="checkbox" disabled={active || mode !== 'DRIVE'} checked={preferences[key]} onChange={(event) => setPreferences((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
          <small>Preferences are requests, not guarantees. They apply to driving only.</small>
        </fieldset>}
        {busy && <p className="nav-calculating" role="status"><span className="nav-spinner" />Calculating real directions...</p>}
        {!busy && !route && <div className="nav-route-empty"><Compass size={25} /><h2>Your next journey starts here.</h2><p>Choose a start and destination, or use the map pins. Routes update automatically.</p></div>}
        {route && !active && <div className="nav-route-options" role="group" aria-label="Available routes">
          {routes.map((option, index) => <button type="button" key={option.id} aria-pressed={selected === index} onClick={() => setSelected(index)} style={{ '--route-color': routeColors[index] }}>
            <span className="nav-route-color" /><div><strong>{formatDuration(option.durationSeconds)}</strong><span>{option.description}</span></div><small>{formatDistance(option.distanceMeters)}{selected === index && <Check size={16} />}</small>
          </button>)}
          {stops.length > 1 && <small>Alternative routes are requested only without intermediate stops.</small>}
        </div>}
        {route?.warnings.map((warning, index) => <p className="nav-notice" key={index}>{warning}</p>)}
        {mode !== 'DRIVE' && <p className="nav-notice">Walking and cycling routes may be incomplete in some areas. Check conditions, signs and safe access.</p>}
        {route && <details className="nav-directions"><summary>Turn-by-turn directions ({route.steps.length})</summary><ol>{route.steps.map((step, index) =>
          <li key={index}><Navigation size={15} aria-hidden="true" /><div>{step.instruction}<small>{formatDistance(step.distanceMeters)}</small></div></li>)}</ol></details>}
        {saved.length > 0 && !active && <details className="nav-saved"><summary><Bookmark size={16} /> Saved on this device ({saved.length})</summary>
          {saved.map((point, index) => <div key={`${point.latitude}-${point.longitude}`}>
            <button type="button" onClick={() => updateStop(stops.length - 1, point)}><MapPin size={16} />{point.label}</button>
            <button type="button" onClick={() => removeSaved(index)} aria-label={`Remove saved destination ${point.label}`}><X size={16} /></button>
          </div>)}
        </details>}
        <p className="nav-safety-note">Maps and routes by {navigationProviderName}, subject to existing provider usage limits. Route estimates are not delivery quotes or proof of service coverage. Stay alert; obey road signs. Browser navigation does not replace a certified navigation device.</p>
      </div>
      <div className="nav-controls" aria-label="Navigation controls">
        {active ? <button className="nav-start" type="button" onClick={() => { navigationRef.current.active = false; stopNavigation(); setExpanded(true); setNotice('Navigation stopped. GPS tracking has ended.') }}><Square size={17} />Stop</button>
          : <button className="nav-start" type="button" disabled={!route || busy || !online || !mapReady} onClick={startNavigation}><Navigation size={18} />Start</button>}
        <button type="button" disabled={actionsDisabled || stops.length >= 9} onClick={() => { setStops((current) => [...current.slice(0, -1), null, current.at(-1)]); setExpanded(true) }}><Plus size={19} />Add stops</button>
        <button type="button" disabled={!origin || stops.some((point) => !point)} onClick={shareRoute}><Share2 size={18} />Share</button>
        <button type="button" disabled={active} aria-expanded={showSettings} onClick={() => { setShowSettings((value) => !value); setExpanded(true) }}><Settings2 size={18} />Settings</button>
        <button type="button" disabled={!stops.at(-1)} onClick={saveDestination}><Bookmark size={18} />Save</button>
      </div>
      {origin && stops.every(Boolean) && !active && <button className="nav-retry-route" type="button" disabled={busy || !online} onClick={() => calculate(origin, stops, mode, preferences)}><RotateCcw size={14} />Refresh directions</button>}
    </section>
  </main>
}

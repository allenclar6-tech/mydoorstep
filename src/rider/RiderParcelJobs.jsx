import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, MapPin, Navigation, Package, Phone, X } from 'lucide-react'
import { formatDistance, formatDuration } from '../map/addressSearch'

const apiBase = globalThis.location?.hostname === 'mydoorstep.com.co' ? '' : import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const auth = () => { try { return { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}` } } catch { return {} } }

async function call(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`${apiBase}${path}`, { method, headers: { ...auth(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  } catch { throw new Error('You appear to be offline. Check your connection and try again.') }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw Object.assign(new Error(data?.message || 'That action could not be completed.'), { code: data?.error })
  return data
}

// Rider-facing stage buttons for package deliveries (server state machine names in brackets).
const parcelStages = {
  ACCEPTED: { next: 'GOING_TO_RESTAURANT', label: 'Start heading to pickup' },
  GOING_TO_RESTAURANT: { next: 'ARRIVED_AT_RESTAURANT', label: 'I’ve arrived at pickup' },
  ARRIVED_AT_RESTAURANT: { next: 'PICKED_UP', label: 'Package collected' },
  PICKED_UP: { next: 'GOING_TO_CUSTOMER', label: 'Start delivery to recipient' },
  GOING_TO_CUSTOMER: { next: 'DELIVERED', label: 'Mark as delivered' },
}
const stageText = { ACCEPTED: 'Accepted', GOING_TO_RESTAURANT: 'Heading to pickup', ARRIVED_AT_RESTAURANT: 'At pickup', PICKED_UP: 'Package collected', GOING_TO_CUSTOMER: 'Delivering', DELIVERED: 'Delivered' }

const directionsUrl = (point) => `https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}&travelmode=driving`
const tel = (phone) => `tel:${String(phone || '').replace(/[^+0-9]/g, '')}`

/** Opt-in, while-online location so customers can see arrival estimates. Foreground only. */
export function AvailabilityLocationToggle({ online }) {
  const [sharing, setSharing] = useState(false)
  const [message, setMessage] = useState('')
  const watchRef = useRef(null)
  const lastSentRef = useRef(0)
  const stop = useCallback((clearOnServer = true) => {
    if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current)
    watchRef.current = null
    setSharing(false)
    if (clearOnServer) call('/api/rider/availability-location', { method: 'DELETE' }).catch(() => undefined)
  }, [])
  useEffect(() => { if (!online && sharing) { stop(false); setMessage('Location sharing stopped because you went offline.') } }, [online])
  useEffect(() => () => { if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current) }, [])
  const start = () => {
    if (!navigator.geolocation) { setMessage('This browser cannot share location.'); return }
    setMessage('Allow location when your browser asks.')
    watchRef.current = navigator.geolocation.watchPosition((position) => {
      if (Date.now() - lastSentRef.current < 30_000) return
      lastSentRef.current = Date.now()
      call('/api/rider/availability-location', { method: 'PUT', body: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp } })
        .then(() => { setSharing(true); setMessage(`Sharing your approximate position (±${Math.round(position.coords.accuracy)} m) so customers see real arrival estimates. Customers never see your exact location before you accept.`) })
        .catch((error) => setMessage(error.message))
    }, (error) => { stop(false); setMessage(error.code === 1 ? 'Location permission was denied. You can still receive requests; customers just won’t see an arrival estimate.' : 'Your location is unavailable right now.') }, { enableHighAccuracy: false, maximumAge: 30_000, timeout: 20_000 })
  }
  if (!online) return null
  return <div className="rider-availability-location">
    <div><strong>Arrival estimates</strong><p>{message || 'Optional: share your approximate position while online so nearby customers can see how far away you are. Updates only while this page is open.'}</p></div>
    {sharing ? <button type="button" className="portal-secondary" onClick={() => { stop(); setMessage('Location sharing stopped.') }}>Stop sharing</button> : <button type="button" className="portal-primary" onClick={start}><MapPin size={15} /> Share while online</button>}
  </div>
}

function Countdown({ until }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const seconds = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000))
  return <span className="rider-countdown" aria-live="off">{seconds}s left</span>
}

function JobSummary({ booking }) {
  return <div className="delivery-route">
    <div><Package size={17} /><span><small>Pickup</small><strong>{booking.pickup.address}</strong></span></div>
    <div className="route-line" />
    <div><MapPin size={17} /><span><small>Drop-off</small><strong>{booking.dropoff.address}</strong></span></div>
    <p className="rider-job-meta">{formatDistance(booking.route.distanceMeters)} by road · about {formatDuration(booking.route.durationSeconds)} · {booking.package.size.toLowerCase()} package · {booking.service.name}</p>
  </div>
}

export function RiderParcelJobs({ online, approved, onActiveChange }) {
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmRelease, setConfirmRelease] = useState(false)
  const load = useCallback(() => call('/api/rider/parcel-jobs').then((body) => { setJobs(body.jobs); setError('') }).catch((loadError) => setError(loadError.message)), [])
  useEffect(() => {
    load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, online ? 10_000 : 30_000)
    return () => window.clearInterval(timer)
  }, [load, online])
  const active = jobs?.find((job) => job.kind === 'ACTIVE')
  useEffect(() => { onActiveChange?.(active || null) }, [active?.deliveryId, active?.status])

  const act = async (key, path, body) => {
    setBusy(key); setError('')
    try { await call(path, { method: 'POST', body }); await load() } catch (actionError) { setError(actionError.message); await load() } finally { setBusy('') }
  }

  if (!jobs) return error ? <p className="profile-message" role="alert">{error}</p> : <div className="empty-state">Loading package jobs…</div>
  const requested = jobs.filter((job) => job.kind === 'REQUESTED_FOR_YOU')
  const open = jobs.filter((job) => job.kind === 'OPEN')

  return <div className="rider-parcel-jobs">
    {error && <p className="profile-message" role="alert">{error}</p>}
    {active && (() => {
      const booking = active.booking
      const stage = parcelStages[active.status]
      const toPickup = ['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT'].includes(active.status)
      return <section className="rider-delivery-card">
        <div className="delivery-card-head"><div><span className="section-kicker">ACTIVE PACKAGE DELIVERY</span><h3>{booking.reference}</h3></div><span className="portal-status accepted">{stageText[active.status] || active.status}</span></div>
        <JobSummary booking={booking} />
        <div className="rider-contacts">
          {booking.pickup.contactName && <p><strong>Pickup contact:</strong> {booking.pickup.contactName} <a href={tel(booking.pickup.contactPhone)}><Phone size={13} /> Call</a>{booking.pickup.notes && <small>{booking.pickup.notes}</small>}</p>}
          {booking.recipient && <p><strong>Recipient:</strong> {booking.recipient.name} <a href={tel(booking.recipient.phone)}><Phone size={13} /> Call</a></p>}
          <p><strong>Package:</strong> {booking.package.description}{booking.instructions && <small>“{booking.instructions}”</small>}</p>
        </div>
        <a className="portal-secondary rider-navigate" href={directionsUrl(toPickup ? booking.pickup : booking.dropoff)} target="_blank" rel="noopener noreferrer"><Navigation size={15} /> Navigate to {toPickup ? 'pickup' : 'recipient'}</a>
        {stage && <button type="button" className="portal-primary" disabled={busy === 'advance'} onClick={() => act('advance', `/api/deliveries/${active.deliveryId}/status`, { status: stage.next })}>{stage.next === 'DELIVERED' ? <Check size={16} /> : <ArrowRight size={16} />} {busy === 'advance' ? 'Updating…' : stage.label}</button>}
        {toPickup && (!confirmRelease
          ? <button type="button" className="text-link" onClick={() => setConfirmRelease(true)}>Can’t do this delivery?</button>
          : <div className="rider-release"><p>Hand this delivery back so another rider can take it? The customer will be told.</p><button type="button" className="portal-secondary" disabled={busy === 'release'} onClick={() => act('release', `/api/deliveries/${active.deliveryId}/release`, { reason: 'Rider unavailable' }).then(() => setConfirmRelease(false))}><X size={14} /> Hand back</button><button type="button" className="text-link" onClick={() => setConfirmRelease(false)}>Keep it</button></div>)}
      </section>
    })()}

    {!active && requested.map((job) => <section className="rider-delivery-card rider-request-card" key={job.deliveryId}>
      <div className="delivery-card-head"><div><span className="section-kicker">REQUESTED FOR YOU</span><h3>{job.booking.reference}</h3></div><Countdown until={job.requestExpiresAt} /></div>
      <JobSummary booking={job.booking} />
      <div className="rider-request-actions">
        <button type="button" className="portal-primary" disabled={Boolean(busy)} onClick={() => act(job.deliveryId, `/api/deliveries/${job.deliveryId}/accept`)}><Check size={16} /> Accept</button>
        <button type="button" className="portal-secondary" disabled={Boolean(busy)} onClick={() => act(`reject-${job.deliveryId}`, `/api/deliveries/${job.deliveryId}/reject`)}><X size={16} /> Decline</button>
      </div>
    </section>)}

    {!active && <section className="orders-panel">
      <div className="panel-heading"><div><span className="section-kicker">OPEN PACKAGE JOBS</span><h3>{online ? 'Accept a package delivery' : 'Go online to accept jobs'}</h3></div></div>
      {!approved && <div className="empty-state">Your rider account must be approved before you can accept jobs.</div>}
      {approved && open.length === 0 && <div className="empty-state">No package jobs are waiting right now.</div>}
      {approved && open.map((job) => <div className="portal-order-row" key={job.deliveryId}>
        <div className="order-id"><strong>{job.booking.reference}</strong><small>{job.booking.service.name}</small></div>
        <div className="order-items">{job.booking.pickup.address} → {job.booking.dropoff.address} · {formatDistance(job.booking.route.distanceMeters)}</div>
        <strong>{job.booking.package.size.toLowerCase()}</strong>
        <button className="small-action" disabled={!online || Boolean(busy)} onClick={() => act(job.deliveryId, `/api/deliveries/${job.deliveryId}/accept`)}>{busy === job.deliveryId ? 'Accepting…' : 'Accept'}</button>
      </div>)}
    </section>}
  </div>
}

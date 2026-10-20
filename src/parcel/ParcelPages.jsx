import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Bike, Check, Clock3, Copy, CreditCard, Landmark, MapPin, Package, Phone, RefreshCw, Star, Truck, X } from 'lucide-react'
import { MapPointPicker } from '../map/MapPointPicker'
import { DeliveryTrackingMap } from '../DeliveryTrackingMap'
import { useDeliveryTracking } from '../tracking/useDeliveryTracking'
import { formatDistance, formatDuration } from '../map/addressSearch'
import { api, ApiError, naira, newIdempotencyKey, statusLabels, statusOrder, token } from './api'
import { cardLabel, SavedCardChoices, useSavedCards } from '../account/SavedCards'

const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const DRAFT_KEY = 'doorstep-parcel-draft-v1'
const targets = [
  { key: 'pickup', label: 'Pickup', shortLabel: 'pickup', badge: 'A', markerClass: 'is-pickup' },
  { key: 'dropoff', label: 'Destination', shortLabel: 'destination', badge: 'B', markerClass: 'is-dropoff' },
]
const sizes = [
  { value: 'SMALL', label: 'Small', hint: 'Fits in a backpack: documents, phone, small parcel' },
  { value: 'MEDIUM', label: 'Medium', hint: 'Shoebox to carton size, up to about 10 kg' },
  { value: 'LARGE', label: 'Large', hint: 'Bulky items that need a larger vehicle' },
]
const phonePattern = /^\+?[0-9][0-9 ()-]{6,19}$/

const emptyDraft = () => ({
  step: 'route',
  points: { pickup: null, dropoff: null },
  previewRouteId: '0',
  serviceCode: '',
  details: { pickupContactName: '', pickupContactPhone: '', pickupNotes: '', recipientName: '', recipientPhone: '', packageDescription: '', packageSize: 'SMALL', instructions: '' },
  routeId: '0',
  paymentMethod: '',
  idempotencyKey: '',
})

function readDraft() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
    return stored && stored.points ? { ...emptyDraft(), ...stored, details: { ...emptyDraft().details, ...stored.details } } : emptyDraft()
  } catch { return emptyDraft() }
}
function writeDraft(draft) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* draft is only kept in memory */ } }
function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ } }

function SignInPrompt({ returnTo }) {
  return <main className="route-page parcel-page"><section className="parcel-card parcel-empty">
    <Package size={28} />
    <h2>Sign in to send a package</h2>
    <p>Bookings, payments and live tracking are tied to your DOORSTEP account.</p>
    <button className="primary-button" type="button" onClick={() => navigate(`/login?return=${encodeURIComponent(returnTo)}`)}>Sign in <ArrowRight size={16} /></button>
  </section></main>
}

function Notice({ tone = 'info', children, action }) {
  return <div className={`parcel-notice is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><span>{children}</span>{action}</div>
}

// ------------------------------------------------------------------------
// Booking flow
// ------------------------------------------------------------------------
export function SendPackagePage() {
  const [draft, setDraftState] = useState(readDraft)
  const [config, setConfig] = useState(null)
  const [configError, setConfigError] = useState('')
  const [quote, setQuote] = useState(null)
  const [quoteState, setQuoteState] = useState('idle')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [previewRoutes, setPreviewRoutes] = useState([])
  const signedIn = Boolean(token())
  const savedCards = useSavedCards()
  const [cardChoice, setCardChoice] = useState('NEW')
  const [saveCard, setSaveCard] = useState(false)
  useEffect(() => {
    const first = savedCards.cards.find((card) => !card.expired)
    if (first) setCardChoice((current) => current === 'NEW' ? first.id : current)
  }, [savedCards.cards.length])

  // The booking flow has its own sticky action bar; lift the chat bubble above it.
  useEffect(() => {
    document.body.classList.add('doorstep-sticky-actions')
    return () => document.body.classList.remove('doorstep-sticky-actions')
  }, [])

  const setDraft = useCallback((update) => {
    setDraftState((current) => {
      const next = typeof update === 'function' ? update(current) : { ...current, ...update }
      writeDraft(next)
      return next
    })
  }, [])

  useEffect(() => {
    api('/api/parcels/config').then((body) => {
      setConfig(body)
      setDraft((current) => ({
        ...current,
        serviceCode: body.services.some((service) => service.code === current.serviceCode) ? current.serviceCode : body.services[0]?.code || '',
        paymentMethod: current.paymentMethod || (body.payments.paystack.enabled ? 'PAYSTACK' : body.payments.bankTransfer.enabled ? 'BANK_TRANSFER' : ''),
      }))
    }).catch((loadError) => setConfigError(loadError.message))
  }, [setDraft])

  // Prefill the pickup contact from the signed-in account once.
  useEffect(() => {
    if (!signedIn) return
    api('/api/auth/me').then(({ user }) => setDraft((current) => ({ ...current, details: { ...current.details, pickupContactName: current.details.pickupContactName || `${user.firstName} ${user.lastName}`.trim(), pickupContactPhone: current.details.pickupContactPhone || user.phone || '' } }))).catch(() => undefined)
  }, [signedIn, setDraft])

  const fetchQuote = useCallback(async () => {
    const { pickup, dropoff } = draft.points
    if (!pickup || !dropoff || !draft.serviceCode) return
    setQuoteState('loading')
    setError('')
    try {
      const body = await api('/api/parcels/quote', { method: 'POST', body: { pickup: { latitude: pickup.latitude, longitude: pickup.longitude }, dropoff: { latitude: dropoff.latitude, longitude: dropoff.longitude }, serviceCode: draft.serviceCode, packageSize: draft.details.packageSize } })
      setQuote(body)
      setQuoteState('ready')
      setDraft((current) => ({ ...current, routeId: body.routes.some((route) => route.id === current.routeId) ? current.routeId : body.routes[0]?.id || '0', idempotencyKey: current.idempotencyKey || newIdempotencyKey() }))
    } catch (quoteError) {
      setQuote(null)
      setQuoteState('error')
      setError(quoteError.message)
    }
  }, [draft.points, draft.serviceCode, draft.details.packageSize, setDraft])

  useEffect(() => { if (draft.step === 'review') fetchQuote() }, [draft.step, draft.serviceCode])

  if (!signedIn) return <SignInPrompt returnTo="/send" />

  const unavailable = config && !config.enabled
  const unavailableText = !config ? '' : config.reason === 'PRICING_NOT_PUBLISHED' ? 'Package delivery is not open yet: DOORSTEP operations has not published delivery fares.' : config.reason === 'ROUTING_NOT_CONFIGURED' ? 'Package delivery is temporarily unavailable: road routing is not configured on the server.' : config.reason === 'PRICING_INVALID' ? 'Package delivery is temporarily unavailable while fares are being corrected.' : ''
  const points = draft.points
  const samePlace = points.pickup && points.dropoff && Math.abs(points.pickup.latitude - points.dropoff.latitude) < 0.0002 && Math.abs(points.pickup.longitude - points.dropoff.longitude) < 0.0002

  const validateDetails = () => {
    const d = draft.details
    const errors = {}
    if (!draft.serviceCode) errors.serviceCode = 'Choose a delivery service.'
    if (!d.pickupContactName.trim()) errors.pickupContactName = 'Who should the rider meet at pickup?'
    if (!phonePattern.test(d.pickupContactPhone.trim())) errors.pickupContactPhone = 'Enter a valid pickup phone number.'
    if (!d.recipientName.trim()) errors.recipientName = 'Enter the recipient’s name.'
    if (!phonePattern.test(d.recipientPhone.trim())) errors.recipientPhone = 'Enter a valid recipient phone number.'
    if (!d.packageDescription.trim()) errors.packageDescription = 'Describe the package so the rider knows what to collect.'
    const service = config?.services.find((item) => item.code === draft.serviceCode)
    if (service && sizes.findIndex((size) => size.value === d.packageSize) > sizes.findIndex((size) => size.value === service.maxPackageSize)) errors.packageSize = `${service.name} accepts up to ${service.maxPackageSize.toLowerCase()} packages.`
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const confirmBooking = async () => {
    const route = quote?.routes.find((item) => item.id === draft.routeId)
    if (!route) return
    if (!draft.paymentMethod) { setError('Choose a payment method.'); return }
    setSubmitting(true)
    setError('')
    const d = draft.details
    try {
      const { booking } = await api('/api/parcels', {
        method: 'POST',
        headers: { 'Idempotency-Key': draft.idempotencyKey || newIdempotencyKey() },
        body: {
          serviceCode: draft.serviceCode,
          routeId: route.id,
          expectedTotalMinor: route.price.totalMinor,
          paymentMethod: draft.paymentMethod,
          pickup: { latitude: points.pickup.latitude, longitude: points.pickup.longitude, address: points.pickup.label.slice(0, 300), contactName: d.pickupContactName.trim(), contactPhone: d.pickupContactPhone.trim(), notes: d.pickupNotes.trim() || undefined },
          dropoff: { latitude: points.dropoff.latitude, longitude: points.dropoff.longitude, address: points.dropoff.label.slice(0, 300) },
          recipient: { name: d.recipientName.trim(), phone: d.recipientPhone.trim() },
          package: { description: d.packageDescription.trim(), size: d.packageSize },
          instructions: d.instructions.trim() || undefined,
        },
      })
      clearDraft()
      if (booking.payment?.method === 'PAYSTACK' && booking.status === 'PENDING_PAYMENT') {
        if (cardChoice !== 'NEW' && savedCards.enabled) {
          // Saved card: charged on the server; the booking page shows the verified result.
          await api('/api/payments/charge-saved-card', { method: 'POST', body: { kind: 'parcel', id: booking.id, cardId: cardChoice } }).catch(() => undefined)
          navigate(`/parcels/${booking.id}`)
          return
        }
        try {
          const payment = await api(`/api/parcels/${booking.id}/pay`, { method: 'POST', body: { saveCard: savedCards.enabled && saveCard } })
          if (payment.authorizationUrl) { window.location.assign(payment.authorizationUrl); return }
        } catch { /* the booking page offers a retry */ }
      }
      navigate(`/parcels/${booking.id}`)
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.code === 'PRICE_CHANGED' && submitError.body?.quote) {
        setQuote(submitError.body.quote)
        setDraft((current) => ({ ...current, routeId: submitError.body.quote.routes[0]?.id || '0' }))
      }
      setError(submitError.message)
    } finally { setSubmitting(false) }
  }

  const steps = [['route', 'Route'], ['details', 'Details'], ['review', 'Review & pay']]
  const stepIndex = steps.findIndex(([key]) => key === draft.step)

  return <main className={`route-page parcel-page parcel-step-${draft.step}`}>
    <nav className="parcel-steps" aria-label="Booking progress">
      {steps.map(([key, label], index) => <button key={key} type="button" className={index === stepIndex ? 'is-current' : index < stepIndex ? 'is-done' : ''} disabled={index > stepIndex} aria-current={index === stepIndex ? 'step' : undefined} onClick={() => index < stepIndex && setDraft({ step: key })}><i>{index < stepIndex ? <Check size={13} /> : index + 1}</i>{label}</button>)}
    </nav>
    {configError && <Notice tone="error" action={<button type="button" className="quiet-button" onClick={() => window.location.reload()}>Retry</button>}>{configError}</Notice>}
    {unavailable && <Notice tone="warning">{unavailableText} You can still plan the route; booking opens once fares are live.</Notice>}

    {draft.step === 'route' && <div className="parcel-route-step">
      <MapPointPicker
        targets={targets}
        value={points}
        onChange={(next) => setDraft((current) => ({ ...current, points: next, idempotencyKey: '' }))}
        heading={{ kicker: 'SEND A PACKAGE · SAPELE', title: 'Where are we picking up and delivering?', intro: 'Set the pickup (A) and destination (B). Search, use GPS, tap the map, or drag a pin.' }}
        onClose={() => navigate('/')}
        routeMode="between"
        selectedRouteId={draft.previewRouteId}
        onSelectRoute={(id) => setDraft({ previewRouteId: id })}
        onRoutes={setPreviewRoutes}
      >
        {samePlace && <Notice tone="warning">Pickup and destination are at the same spot. Move one of the pins.</Notice>}
        <button type="button" className="primary-button parcel-continue" disabled={!points.pickup || !points.dropoff || samePlace} onClick={() => setDraft({ step: 'details' })}>
          {!points.pickup ? 'Set the pickup point' : !points.dropoff ? 'Set the destination' : <>Continue to details <ArrowRight size={16} /></>}
        </button>
        {points.pickup && points.dropoff && previewRoutes.length === 0 && <small className="parcel-hint">The final road distance and price are calculated by DOORSTEP on the next steps.</small>}
      </MapPointPicker>
    </div>}

    {draft.step === 'details' && <section className="parcel-card parcel-details">
      <header className="parcel-card-head"><button type="button" className="map-icon-button" aria-label="Back to route" onClick={() => setDraft({ step: 'route' })}><ArrowLeft size={18} /></button><div><span className="section-kicker">STEP 2 OF 3</span><h2>Package and contact details</h2></div></header>
      <div className="parcel-route-summary">
        <p><i className="parcel-dot is-pickup">A</i><span><small>Pickup</small>{points.pickup?.label}</span></p>
        <p><i className="parcel-dot is-dropoff">B</i><span><small>Destination</small>{points.dropoff?.label}</span></p>
        <button type="button" className="quiet-button" onClick={() => setDraft({ step: 'route' })}>Edit route</button>
      </div>
      <form noValidate onSubmit={(event) => { event.preventDefault(); if (validateDetails()) setDraft({ step: 'review' }) }}>
        <fieldset className="parcel-services">
          <legend>Delivery service</legend>
          {!config && <p className="parcel-hint" role="status">Loading available services…</p>}
          {config && config.services.length === 0 && <p className="parcel-hint">No delivery services are published yet.</p>}
          {config?.services.map((service) => <label key={service.code} className={`parcel-service${draft.serviceCode === service.code ? ' is-selected' : ''}`}>
            <input type="radio" name="service" value={service.code} checked={draft.serviceCode === service.code} onChange={() => setDraft({ serviceCode: service.code })} />
            <span className="parcel-service-icon" aria-hidden="true">{/van|car|truck/i.test(service.vehicleTypes.join(' ')) ? <Truck size={20} /> : <Bike size={20} />}</span>
            <span><strong>{service.name}</strong><small>{service.description || service.vehicleTypes.join(', ')}</small><small>{naira(service.baseFeeMinor)} base + {naira(service.perKmMinor)}/km · minimum {naira(service.minimumFareMinor)} · up to {service.maxPackageSize.toLowerCase()}</small></span>
          </label>)}
          {fieldErrors.serviceCode && <small className="parcel-field-error">{fieldErrors.serviceCode}</small>}
        </fieldset>
        <div className="parcel-form-grid">
          <Field label="Pickup contact name" error={fieldErrors.pickupContactName}><input autoComplete="name" value={draft.details.pickupContactName} onChange={(event) => setDraft((current) => ({ ...current, details: { ...current.details, pickupContactName: event.target.value } }))} /></Field>
          <Field label="Pickup phone" error={fieldErrors.pickupContactPhone}><input type="tel" inputMode="tel" autoComplete="tel" value={draft.details.pickupContactPhone} onChange={(event) => setDraft((current) => ({ ...current, details: { ...current.details, pickupContactPhone: event.target.value } }))} placeholder="080 0000 0000" /></Field>
          <Field label="Pickup notes (optional)" wide><input value={draft.details.pickupNotes} maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, details: { ...current.details, pickupNotes: event.target.value } }))} placeholder="Gate colour, floor, landmark" /></Field>
          <Field label="Recipient name" error={fieldErrors.recipientName}><input value={draft.details.recipientName} onChange={(event) => setDraft((current) => ({ ...current, details: { ...current.details, recipientName: event.target.value } }))} /></Field>
          <Field label="Recipient phone" error={fieldErrors.recipientPhone}><input type="tel" inputMode="tel" value={draft.details.recipientPhone} onChange={(event) => setDraft((current) => ({ ...current, details: { ...current.details, recipientPhone: event.target.value } }))} placeholder="080 0000 0000" /></Field>
          <Field label="What are you sending?" error={fieldErrors.packageDescription} wide><input value={draft.details.packageDescription} maxLength={300} onChange={(event) => setDraft((current) => ({ ...current, details: { ...current.details, packageDescription: event.target.value } }))} placeholder="e.g. Sealed envelope with documents" /></Field>
        </div>
        <fieldset className="parcel-sizes">
          <legend>Package size</legend>
          {sizes.map((size) => <label key={size.value} className={draft.details.packageSize === size.value ? 'is-selected' : ''}><input type="radio" name="size" value={size.value} checked={draft.details.packageSize === size.value} onChange={() => setDraft((current) => ({ ...current, details: { ...current.details, packageSize: size.value } }))} /><strong>{size.label}</strong><small>{size.hint}</small></label>)}
          {fieldErrors.packageSize && <small className="parcel-field-error">{fieldErrors.packageSize}</small>}
        </fieldset>
        <Field label="Delivery instructions (optional)" wide><textarea rows={2} maxLength={500} value={draft.details.instructions} onChange={(event) => setDraft((current) => ({ ...current, details: { ...current.details, instructions: event.target.value } }))} placeholder="Call on arrival, leave with security, etc." /></Field>
        <div className="parcel-sticky-actions"><button className="primary-button" type="submit" disabled={unavailable}>Review price <ArrowRight size={16} /></button></div>
      </form>
    </section>}

    {draft.step === 'review' && <section className="parcel-card parcel-review">
      <header className="parcel-card-head"><button type="button" className="map-icon-button" aria-label="Back to details" onClick={() => setDraft({ step: 'details' })}><ArrowLeft size={18} /></button><div><span className="section-kicker">STEP 3 OF 3</span><h2>Review and confirm</h2></div></header>
      {quoteState === 'loading' && <p className="parcel-hint" role="status">Calculating the road route and price on DOORSTEP servers…</p>}
      {error && <Notice tone="error" action={quoteState === 'error' ? <button type="button" className="quiet-button" onClick={fetchQuote}><RefreshCw size={14} /> Try again</button> : null}>{error}</Notice>}
      {quote && <>
        <div className="parcel-route-options" role="radiogroup" aria-label="Choose a route">
          {quote.routes.map((route, index) => <label key={route.id} className={draft.routeId === route.id ? 'is-selected' : ''}>
            <input type="radio" name="route" checked={draft.routeId === route.id} onChange={() => setDraft({ routeId: route.id })} />
            <span><strong>{index === 0 ? 'Recommended route' : `Alternative ${index}`}</strong><small>{formatDistance(route.distanceMeters)} by road · about {formatDuration(route.durationSeconds)}</small></span>
            <b>{naira(route.price.totalMinor)}</b>
          </label>)}
        </div>
        {(() => {
          const route = quote.routes.find((item) => item.id === draft.routeId) || quote.routes[0]
          const service = config?.services.find((item) => item.code === draft.serviceCode)
          return route && <dl className="parcel-price">
            <div><dt>Base fare ({quote.service.name})</dt><dd>{naira(route.price.baseFeeMinor)}</dd></div>
            <div><dt>Distance ({formatDistance(route.distanceMeters)}{service ? ` × ${naira(service.perKmMinor)}/km` : ''})</dt><dd>{naira(route.price.distanceFeeMinor)}</dd></div>
            {route.price.minimumFareAdjustmentMinor > 0 && <div><dt>Minimum fare adjustment</dt><dd>{naira(route.price.minimumFareAdjustmentMinor)}</dd></div>}
            {route.price.serviceFeeMinor > 0 && <div><dt>Service fee</dt><dd>{naira(route.price.serviceFeeMinor)}</dd></div>}
            <div className="parcel-price-total"><dt>Total</dt><dd>{naira(route.price.totalMinor)}</dd></div>
            <p className="parcel-hint">{quote.disclaimer}</p>
          </dl>
        })()}
        <fieldset className="parcel-payment">
          <legend>Payment method</legend>
          {config?.payments.paystack.enabled && <label className={draft.paymentMethod === 'PAYSTACK' ? 'is-selected' : ''}><input type="radio" name="payment" checked={draft.paymentMethod === 'PAYSTACK'} onChange={() => setDraft({ paymentMethod: 'PAYSTACK' })} /><CreditCard size={18} /><span><strong>Card or bank via Paystack</strong><small>Paystack shows the channels enabled for DOORSTEP’s account.{config.payments.paystack.mode === 'test' ? ' TEST MODE: no real money is charged.' : ''}</small></span></label>}
          {draft.paymentMethod === 'PAYSTACK' && savedCards.enabled && <SavedCardChoices cards={savedCards.cards} value={cardChoice} onChange={setCardChoice} saveCard={saveCard} onSaveCardChange={setSaveCard} enabled={savedCards.enabled} name="parcel-card" />}
          {config?.payments.bankTransfer.enabled && <label className={draft.paymentMethod === 'BANK_TRANSFER' ? 'is-selected' : ''}><input type="radio" name="payment" checked={draft.paymentMethod === 'BANK_TRANSFER'} onChange={() => setDraft({ paymentMethod: 'BANK_TRANSFER' })} /><Landmark size={18} /><span><strong>Direct bank transfer</strong><small>Transfer to DOORSTEP’s account; confirmed manually by our team before a rider is assigned.</small></span></label>}
          {config && !config.payments.paystack.enabled && !config.payments.bankTransfer.enabled && <p className="parcel-hint">No payment method is available right now.</p>}
        </fieldset>
        <div className="parcel-sticky-actions"><button className="primary-button" type="button" disabled={submitting || quoteState !== 'ready' || !draft.paymentMethod || unavailable} onClick={confirmBooking}>{submitting ? 'Creating booking…' : <>Confirm and pay {naira((quote.routes.find((item) => item.id === draft.routeId) || quote.routes[0]).price.totalMinor)}</>}</button></div>
      </>}
    </section>}
  </main>
}

function Field({ label, error, wide = false, children }) {
  return <label className={`parcel-field${wide ? ' is-wide' : ''}${error ? ' has-error' : ''}`}><span>{label}</span>{children}{error && <small className="parcel-field-error">{error}</small>}</label>
}

// ------------------------------------------------------------------------
// Booking list
// ------------------------------------------------------------------------
export function ParcelListPage() {
  const [bookings, setBookings] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => { setError(''); api('/api/parcels').then((body) => setBookings(body.bookings)).catch((loadError) => setError(loadError.message)) }, [])
  useEffect(() => { if (token()) load() }, [load])
  if (!token()) return <SignInPrompt returnTo="/parcels" />
  const active = (bookings || []).filter((booking) => !['DELIVERED', 'CANCELLED'].includes(booking.status))
  const past = (bookings || []).filter((booking) => ['DELIVERED', 'CANCELLED'].includes(booking.status))
  const row = (booking) => <button key={booking.id} type="button" className="parcel-row" onClick={() => navigate(`/parcels/${booking.id}`)}>
    <span className="parcel-row-icon"><Package size={18} /></span>
    <span className="parcel-row-main"><strong>{booking.reference}</strong><small>{booking.pickup.address} → {booking.dropoff.address}</small><small>{new Date(booking.timestamps.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
    <span className="parcel-row-side"><span className={`parcel-status is-${booking.status.toLowerCase()}`}>{booking.statusLabel}</span><b>{naira(booking.price.totalMinor)}</b></span>
  </button>
  return <main className="route-page parcel-page">
    <section className="parcel-card">
      <header className="parcel-card-head"><div><span className="section-kicker">PACKAGE DELIVERIES</span><h2>Your packages</h2></div><button type="button" className="primary-button" onClick={() => navigate('/send')}>Send a package</button></header>
      {error && <Notice tone="error" action={<button type="button" className="quiet-button" onClick={load}>Retry</button>}>{error}</Notice>}
      {!bookings && !error && <p className="parcel-hint" role="status">Loading your bookings…</p>}
      {bookings && bookings.length === 0 && <div className="parcel-empty"><Package size={26} /><h3>No packages yet</h3><p>Book a rider to move documents, parcels and everyday items across Sapele.</p></div>}
      {active.length > 0 && <><h3 className="parcel-subhead">Active</h3><div className="parcel-rows">{active.map(row)}</div></>}
      {past.length > 0 && <><h3 className="parcel-subhead">History</h3><div className="parcel-rows">{past.map(row)}</div></>}
    </section>
  </main>
}

// ------------------------------------------------------------------------
// Booking detail: payment, rider choice, live tracking, edits, cancel, rating
// ------------------------------------------------------------------------
export function ParcelDetailPage({ bookingId }) {
  const [booking, setBooking] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [editing, setEditing] = useState(false)
  const load = useCallback(async () => {
    try { const body = await api(`/api/parcels/${bookingId}`); setBooking(body.booking); setError('') } catch (loadError) { setError(loadError.message) }
  }, [bookingId])
  useEffect(() => { if (token()) load() }, [load])
  const terminal = booking && ['DELIVERED', 'CANCELLED'].includes(booking.status)
  useEffect(() => {
    if (!booking || terminal) return undefined
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, booking.status === 'SEARCHING_FOR_RIDER' || booking.status === 'PENDING_PAYMENT' ? 10_000 : 20_000)
    return () => window.clearInterval(timer)
  }, [booking?.status, terminal, load])
  const tracking = useDeliveryTracking(booking?.delivery?.active ? booking.delivery.id : null)
  useEffect(() => { if (tracking.refreshKey) load() }, [tracking.refreshKey])

  if (!token()) return <SignInPrompt returnTo={`/parcels/${bookingId}`} />
  if (!booking) return <main className="route-page parcel-page"><section className="parcel-card">{error ? <Notice tone="error" action={<button type="button" className="quiet-button" onClick={load}>Retry</button>}>{error}</Notice> : <p className="parcel-hint" role="status">Loading booking…</p>}</section></main>

  const act = async (key, path, body, success) => {
    setBusy(key); setNotice(''); setError('')
    try { const result = await api(path, { method: 'POST', body }); if (result.booking) setBooking(result.booking); else await load(); if (success) setNotice(typeof success === 'function' ? success(result) : success); return result } catch (actionError) { setError(actionError.message); return null } finally { setBusy('') }
  }

  const payWithCard = async (cardId) => {
    const result = await act('card', '/api/payments/charge-saved-card', { kind: 'parcel', id: booking.id, cardId })
    if (result) setNotice(result.status === 'SUCCESSFUL' ? 'Payment confirmed.' : result.message || 'The card payment did not go through. Try another card or pay on Paystack.')
    load()
  }
  const pay = async () => {
    const result = await act('pay', `/api/parcels/${booking.id}/pay`)
    if (result?.authorizationUrl) window.location.assign(result.authorizationUrl)
    else if (result?.paid) setNotice('Payment confirmed by Paystack.')
  }

  const staticSnapshot = { kind: 'parcel', parcel: { id: booking.id, pickup: booking.pickup, destination: booking.dropoff, route: booking.route }, delivery: { status: booking.delivery?.status, active: false, location: null } }
  const mapSnapshot = tracking.snapshot?.parcel ? tracking.snapshot : staticSnapshot
  const currentIndex = statusOrder.indexOf(booking.status)

  return <main className="route-page parcel-page parcel-detail">
    <section className="parcel-card">
      <header className="parcel-card-head">
        <button type="button" className="map-icon-button" aria-label="All packages" onClick={() => navigate('/parcels')}><ArrowLeft size={18} /></button>
        <div><span className="section-kicker">{booking.reference}</span><h2>{booking.statusLabel}</h2></div>
        <span className={`parcel-status is-${booking.status.toLowerCase()}`}>{booking.service.name}</span>
      </header>
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {booking.status !== 'CANCELLED' && <ol className="parcel-timeline" aria-label="Delivery progress">
        {statusOrder.map((status, index) => <li key={status} className={index < currentIndex ? 'is-done' : index === currentIndex ? 'is-current' : ''}><i aria-hidden="true">{index < currentIndex ? <Check size={12} /> : ''}</i><span>{statusLabels[status]}</span></li>)}
      </ol>}
      {booking.status === 'CANCELLED' && <Notice tone="warning">This booking was cancelled{booking.cancellationReason ? `: ${booking.cancellationReason}` : '.'}{booking.payment?.status === 'SUCCESSFUL' ? ' Your payment has been flagged for a refund review by DOORSTEP.' : ''}</Notice>}

      <DeliveryTrackingMap tracking={mapSnapshot} connection={tracking.connection} />

      <div className="parcel-detail-grid">
        <div className="parcel-panel">
          <h3>Route</h3>
          <p className="parcel-stop"><i className="parcel-dot is-pickup">A</i><span><small>Pickup</small>{booking.pickup.address}{booking.pickup.contactName && <em>{booking.pickup.contactName} · {booking.pickup.contactPhone}</em>}</span></p>
          <p className="parcel-stop"><i className="parcel-dot is-dropoff">B</i><span><small>Destination</small>{booking.dropoff.address}{booking.recipient && <em>{booking.recipient.name} · {booking.recipient.phone}</em>}</span></p>
          <p className="parcel-hint">{formatDistance(booking.route.distanceMeters)} by road · about {formatDuration(booking.route.durationSeconds)} driving (estimate, not a guarantee)</p>
          <p className="parcel-hint"><Package size={13} /> {booking.package.description} · {booking.package.size.toLowerCase()}{booking.instructions ? ` · “${booking.instructions}”` : ''}</p>
          {booking.permissions.canEdit && !editing && <button type="button" className="quiet-button" onClick={() => setEditing(true)}>Edit details</button>}
          {editing && <EditBooking booking={booking} onCancel={() => setEditing(false)} onSaved={(updated) => { setBooking(updated); setEditing(false); setNotice('Booking details updated.') }} />}
        </div>

        <div className="parcel-panel">
          <h3>Price</h3>
          <dl className="parcel-price compact">
            <div><dt>Base fare</dt><dd>{naira(booking.price.baseFeeMinor)}</dd></div>
            <div><dt>Distance</dt><dd>{naira(booking.price.distanceFeeMinor)}</dd></div>
            {booking.price.minimumFareAdjustmentMinor > 0 && <div><dt>Minimum fare adjustment</dt><dd>{naira(booking.price.minimumFareAdjustmentMinor)}</dd></div>}
            {booking.price.serviceFeeMinor > 0 && <div><dt>Service fee</dt><dd>{naira(booking.price.serviceFeeMinor)}</dd></div>}
            <div className="parcel-price-total"><dt>Total</dt><dd>{naira(booking.price.totalMinor)}</dd></div>
          </dl>
          {booking.payment && <PaymentPanel booking={booking} busy={busy} onPay={pay} onPayWithCard={payWithCard} onRefresh={load} />}
        </div>

        {booking.status === 'SEARCHING_FOR_RIDER' && <RiderChooser booking={booking} onChanged={(updated) => setBooking(updated)} />}

        {booking.rider && <div className="parcel-panel">
          <h3>Your rider</h3>
          <p className="parcel-rider"><span className="parcel-rider-avatar">{booking.rider.firstName.charAt(0)}</span><span><strong>{booking.rider.firstName}</strong><small>{booking.rider.vehicleType || 'Vehicle not specified'}{booking.rider.rating ? ` · ★ ${booking.rider.rating.average.toFixed(1)} (${booking.rider.rating.count})` : ' · No ratings yet'}</small></span>{booking.rider.phone && <a className="quiet-button" href={`tel:${booking.rider.phone.replace(/[^+0-9]/g, '')}`}><Phone size={14} /> Call</a>}</p>
        </div>}

        {booking.permissions.canRate && <RateRider booking={booking} onRated={(updated) => { setBooking(updated); setNotice('Thanks for rating your rider.') }} />}
        {booking.riderRating && <div className="parcel-panel"><h3>Your rating</h3><p aria-label={`${booking.riderRating} out of 5`}>{'★'.repeat(booking.riderRating)}{'☆'.repeat(5 - booking.riderRating)}</p></div>}

        <div className="parcel-panel">
          <h3>History</h3>
          <ul className="parcel-events">{booking.events.map((event, index) => <li key={index}><Clock3 size={13} /><span><strong>{event.label}</strong>{event.note && <small>{event.note}</small>}<small>{new Date(event.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</small></span></li>)}</ul>
        </div>
      </div>

      {booking.permissions.canCancel && <div className="parcel-cancel">
        {!confirmCancel ? <button type="button" className="quiet-button danger" onClick={() => setConfirmCancel(true)}><X size={14} /> Cancel booking</button> : <div className="parcel-confirm" role="group" aria-label="Confirm cancellation">
          <p>{booking.payment?.status === 'SUCCESSFUL' ? 'This booking is paid. Cancelling flags your payment for a refund review by DOORSTEP; refunds are not automatic.' : 'Cancel this booking?'}</p>
          <button type="button" className="quiet-button danger" disabled={busy === 'cancel'} onClick={() => act('cancel', `/api/parcels/${booking.id}/cancel`, { reason: 'Cancelled by customer' }, 'Booking cancelled.').then(() => setConfirmCancel(false))}>{busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel'}</button>
          <button type="button" className="quiet-button" onClick={() => setConfirmCancel(false)}>Keep booking</button>
        </div>}
      </div>}
    </section>
  </main>
}

function PaymentPanel({ booking, busy, onPay, onPayWithCard, onRefresh }) {
  const [copied, setCopied] = useState('')
  const savedCards = useSavedCards()
  const usableCards = savedCards.enabled ? savedCards.cards.filter((card) => !card.expired) : []
  const payment = booking.payment
  const copy = async (label, value) => { try { await navigator.clipboard.writeText(value); setCopied(label) } catch { setCopied('') } }
  const statusText = { PENDING: 'Waiting for payment', PENDING_VERIFICATION: 'Waiting for DOORSTEP to confirm your transfer', SUCCESSFUL: 'Paid and verified', FAILED: 'Payment failed', ABANDONED: 'Payment not completed', EXPIRED: 'Payment window expired', AMOUNT_MISMATCH: 'Payment amount did not match. Contact support.', REFUNDED: 'Refunded' }
  return <div className="parcel-payment-status">
    <p><strong>{statusText[payment.status] || payment.status}</strong><small>{payment.method === 'PAYSTACK' ? 'Paystack' : 'Bank transfer'} · ref {payment.reference}</small></p>
    {payment.method === 'BANK_TRANSFER' && payment.instructions && payment.status === 'PENDING_VERIFICATION' && <div className="bank-transfer-details">
      <p><strong>Bank</strong>{payment.instructions.bankName}</p>
      <p><strong>Account name</strong>{payment.instructions.accountName}</p>
      <p><strong>Account number</strong>{payment.instructions.accountNumber} <button type="button" className="quiet-button" onClick={() => copy('account', payment.instructions.accountNumber)}><Copy size={13} /> {copied === 'account' ? 'Copied' : 'Copy'}</button></p>
      <p><strong>Amount</strong>{naira(booking.price.totalMinor)}</p>
      <p><strong>Reference</strong>{payment.reference} <button type="button" className="quiet-button" onClick={() => copy('reference', payment.reference)}><Copy size={13} /> {copied === 'reference' ? 'Copied' : 'Copy'}</button></p>
      {payment.instructions.message && <p className="parcel-hint">{payment.instructions.message}</p>}
      {payment.expiresAt && <p className="parcel-hint">Transfer before {new Date(payment.expiresAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}.</p>}
    </div>}
    {booking.permissions.canPay && payment.method === 'PAYSTACK' && usableCards.map((card) => <button type="button" key={card.id} className="quiet-button saved-card-pay" disabled={Boolean(busy)} onClick={() => onPayWithCard(card.id)}><CreditCard size={15} /> {busy === 'card' ? 'Charging card…' : `Pay with ${cardLabel(card)}`}</button>)}
    {booking.permissions.canPay && payment.method === 'PAYSTACK' && <button type="button" className="primary-button" disabled={busy === 'pay'} onClick={onPay}><CreditCard size={16} /> {busy === 'pay' ? 'Opening Paystack…' : ['FAILED', 'ABANDONED', 'EXPIRED'].includes(payment.status) ? 'Retry payment' : 'Pay now'}</button>}
    {booking.permissions.canPay && <button type="button" className="quiet-button" onClick={onRefresh}><RefreshCw size={13} /> Refresh status</button>}
  </div>
}

function RiderChooser({ booking, onChanged }) {
  const [riders, setRiders] = useState(null)
  const [pending, setPending] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [now, setNow] = useState(Date.now())
  const load = useCallback(() => api(`/api/parcels/${booking.id}/riders`).then((body) => { setRiders(body.riders); setPending(body.request); setError('') }).catch((loadError) => setError(loadError.message)), [booking.id])
  useEffect(() => { load(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 15_000); return () => window.clearInterval(timer) }, [load])
  useEffect(() => { if (!pending) return undefined; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [pending])
  const request = async (riderId) => {
    setBusy(riderId); setError('')
    try { const body = await api(`/api/parcels/${booking.id}/request-rider`, { method: 'POST', body: { riderId } }); onChanged(body.booking); await load() } catch (requestError) { setError(requestError.message); load() } finally { setBusy('') }
  }
  const secondsLeft = pending ? Math.max(0, Math.round((new Date(pending.expiresAt).getTime() - now) / 1000)) : 0
  return <div className="parcel-panel parcel-riders">
    <h3>Available riders</h3>
    <p className="parcel-hint">Any online rider can accept this delivery. You can also ask a specific rider; they have 2 minutes to respond.</p>
    {error && <Notice tone="error">{error}</Notice>}
    {pending && secondsLeft > 0 && <Notice tone="info">Waiting for {riders?.find((rider) => rider.id === pending.riderId)?.firstName || 'the rider'} to respond · {secondsLeft}s</Notice>}
    {!riders && !error && <p className="parcel-hint" role="status">Checking which riders are online…</p>}
    {riders && riders.length === 0 && <p className="parcel-empty-line">No riders are online right now. Your booking stays open and the first rider to come online can accept it.</p>}
    {riders && riders.length > 0 && <ul className="parcel-rider-list">{riders.map((rider) => <li key={rider.id}>
      <span className="parcel-rider-avatar">{rider.firstName.charAt(0)}</span>
      <span className="parcel-rider-main"><strong>{rider.firstName}</strong><small>{rider.vehicleType || 'Vehicle not specified'} · {rider.rating ? `★ ${rider.rating.average.toFixed(1)} (${rider.rating.count})` : 'No ratings yet'} · {rider.completedDeliveries} completed</small><small>{rider.arrival ? `About ${formatDuration(rider.arrival.etaSeconds)} to pickup by road (${formatDistance(rider.arrival.roadDistanceMeters)})` : rider.locationShared ? 'Arrival estimate unavailable right now' : 'Location not shared · arrival estimate unavailable'}</small></span>
      <button type="button" className="quiet-button" disabled={Boolean(busy) || (pending && secondsLeft > 0)} onClick={() => request(rider.id)}>{busy === rider.id ? 'Requesting…' : pending?.riderId === rider.id && secondsLeft > 0 ? 'Requested' : 'Request'}</button>
    </li>)}</ul>}
  </div>
}

function RateRider({ booking, onRated }) {
  const [rating, setRating] = useState(0)
  const [error, setError] = useState('')
  const submit = async () => { try { const body = await api(`/api/parcels/${booking.id}/rate`, { method: 'POST', body: { rating } }); onRated(body.booking) } catch (rateError) { setError(rateError.message) } }
  return <div className="parcel-panel">
    <h3>Rate {booking.rider?.firstName || 'your rider'}</h3>
    <div className="parcel-stars" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value > 1 ? 's' : ''}`} className={value <= rating ? 'is-on' : ''} onClick={() => setRating(value)}><Star size={22} /></button>)}</div>
    {error && <Notice tone="error">{error}</Notice>}
    <button type="button" className="primary-button" disabled={!rating} onClick={submit}>Submit rating</button>
  </div>
}

function EditBooking({ booking, onCancel, onSaved }) {
  const [form, setForm] = useState({ contactName: booking.pickup.contactName || '', contactPhone: booking.pickup.contactPhone || '', notes: booking.pickup.notes || '', recipientName: booking.recipient?.name || '', recipientPhone: booking.recipient?.phone || '', description: booking.package.description, instructions: booking.instructions || '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const save = async (event) => {
    event.preventDefault()
    if (!phonePattern.test(form.contactPhone.trim()) || !phonePattern.test(form.recipientPhone.trim())) { setError('Enter valid phone numbers.'); return }
    setSaving(true)
    try {
      const body = await api(`/api/parcels/${booking.id}`, { method: 'PATCH', body: { pickup: { contactName: form.contactName.trim(), contactPhone: form.contactPhone.trim(), notes: form.notes.trim() }, recipient: { name: form.recipientName.trim(), phone: form.recipientPhone.trim() }, package: { description: form.description.trim() }, instructions: form.instructions.trim() } })
      onSaved(body.booking)
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }
  return <form className="parcel-edit" onSubmit={save}>
    <p className="parcel-hint">Pickup and destination can’t be changed after pricing; cancel and rebook to change the route.</p>
    <div className="parcel-form-grid">
      <Field label="Pickup contact"><input value={form.contactName} onChange={update('contactName')} required /></Field>
      <Field label="Pickup phone"><input type="tel" value={form.contactPhone} onChange={update('contactPhone')} required /></Field>
      <Field label="Recipient"><input value={form.recipientName} onChange={update('recipientName')} required /></Field>
      <Field label="Recipient phone"><input type="tel" value={form.recipientPhone} onChange={update('recipientPhone')} required /></Field>
      <Field label="Package" wide><input value={form.description} onChange={update('description')} required maxLength={300} /></Field>
      <Field label="Pickup notes" wide><input value={form.notes} onChange={update('notes')} maxLength={500} /></Field>
      <Field label="Instructions" wide><input value={form.instructions} onChange={update('instructions')} maxLength={500} /></Field>
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="parcel-inline-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button><button className="quiet-button" type="button" onClick={onCancel}>Cancel</button></div>
  </form>
}

// ------------------------------------------------------------------------
// Payment callback (Paystack returns here with ?reference=)
// ------------------------------------------------------------------------
export function PaymentResultPage() {
  const params = new URLSearchParams(window.location.search)
  const reference = params.get('reference') || params.get('trxref')
  const [state, setState] = useState(reference ? 'checking' : 'missing')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const attempts = useRef(0)
  const verify = useCallback(async () => {
    if (!reference) return
    setState('checking'); setError('')
    try {
      const body = await api('/api/payments/verify', { method: 'POST', body: { reference } })
      setResult(body)
      if (body.kind === 'card') {
        const stillProcessing = body.status === 'PENDING' && ['ongoing', 'pending', 'processing', 'queued'].includes(body.providerStatus)
        setState(body.status === 'SUCCEEDED' ? 'card-saved' : body.status === 'NOT_REUSABLE' ? 'card-not-reusable' : body.status === 'FAILED' ? 'card-failed' : body.status === 'MISMATCH' ? 'error' : stillProcessing ? 'pending' : 'card-not-completed')
        if (stillProcessing && attempts.current < 6) { attempts.current += 1; window.setTimeout(verify, 5000) }
        return
      }
      if (body.status === 'SUCCESSFUL') setState('success')
      else if (body.status === 'FAILED') setState('failed')
      else if (body.providerStatus === 'ongoing' || body.providerStatus === 'pending' || body.providerStatus === 'processing') {
        setState('pending')
        if (attempts.current < 6) { attempts.current += 1; window.setTimeout(verify, 5000) }
      } else setState('incomplete')
    } catch (verifyError) { setError(verifyError.message); setState('error') }
  }, [reference])
  useEffect(() => { if (token()) verify() }, [verify])
  if (!token()) return <SignInPrompt returnTo={`${window.location.pathname}${window.location.search}`} />
  const target = result?.kind === 'parcel' ? `/parcels/${result.id}` : result?.kind === 'card' ? '/account/cards' : '/account/orders'
  const copy = {
    'card-saved': ['Card saved', `Your card is ready for faster checkout. The verification charge is being refunded${result?.refundStatus === 'failed' ? '; our team has been asked to refund it manually' : ''}.`],
    'card-not-reusable': ['This card can’t be saved', 'Paystack did not allow this card to be reused. The verification charge is being refunded. You can still pay with it on Paystack each time.'],
    'card-failed': ['Card not added', `Paystack could not take the verification charge${result?.gatewayResponse ? ` (“${result.gatewayResponse}”)` : ''}, so nothing was charged. If Paystack said “Unable to process transaction”, its fraud check has paused this card for about 24 hours after repeated tries — wait a day, check with your bank that online payments are on, or tick “Save my card” on your next order instead.`],
    'card-not-completed': ['Card not added', 'The Paystack step was not finished, so no card was saved and nothing was kept. You can try again, or tick “Save my card” the next time you pay for an order.'],
    checking: ['Confirming your payment', 'Asking Paystack directly. Please don’t pay again while this is in progress.'],
    success: ['Payment confirmed', result?.kind === 'parcel' ? 'Your package booking is paid. Next, a rider will be assigned.' : 'Your order is paid and the restaurant has been notified.'],
    pending: ['Payment still processing', 'Paystack has not finished processing this payment. We will keep checking for a short while.'],
    incomplete: ['Payment not completed', 'Paystack reports this payment was not completed. You can retry from your booking.'],
    failed: ['Payment failed', 'No payment was taken for this attempt. You can retry from your booking.'],
    error: ['We couldn’t confirm the payment yet', error || 'Try again in a moment. If you were charged, DOORSTEP will reconcile it from Paystack’s confirmation.'],
    missing: ['No payment reference', 'Open your bookings to see the latest payment status.'],
  }[state]
  return <main className="route-page parcel-page"><section className="parcel-card parcel-empty">
    {state === 'success' || state === 'card-saved' ? <Check size={28} /> : <Clock3 size={28} />}
    <h2>{copy[0]}</h2>
    <p>{copy[1]}</p>
    {reference && <p className="parcel-hint">Reference: {reference}</p>}
    <div className="parcel-inline-actions">
      {(state === 'error' || state === 'pending') && <button className="quiet-button" type="button" onClick={verify}><RefreshCw size={14} /> Check again</button>}
      <button className="primary-button" type="button" onClick={() => navigate(result ? target : '/parcels')}>{result?.kind === 'order' ? 'View my orders' : result?.kind === 'card' ? 'Payment methods' : 'View my booking'} <ArrowRight size={16} /></button>
    </div>
  </section></main>
}

export function SendPackageEntry() {
  return <button type="button" className="send-package-entry" onClick={() => navigate('/send')}><span><MapPin size={18} /></span><span><strong>Send a package</strong><small>Book a rider from A to B in Sapele</small></span><ArrowRight size={18} /></button>
}

export const parcelRouteFor = (path) => {
  if (path === '/send') return <SendPackagePage />
  if (path === '/parcels') return <ParcelListPage />
  if (path.startsWith('/parcels/')) return <ParcelDetailPage bookingId={decodeURIComponent(path.split('/')[2] || '')} />
  return null
}


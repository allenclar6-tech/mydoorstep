import { useCallback, useEffect, useRef, useState } from 'react'
import { Bike, Clock3, MapPin, Package, Store, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { formatNaira } from '../data'

const authHeaders = () => { let token = null; try { token = localStorage.getItem('doorstep-token') } catch { token = null } return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }

/**
 * Glovo-style job offer for riders: DOORSTEP offers each order to the nearest free rider for a few seconds.
 * The card shows what the rider earns and where the trip goes, with a countdown; accepting starts the delivery.
 */
export function RiderOfferCard({ online, busy, onAccepted }) {
  const [offer, setOffer] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [acting, setActing] = useState('')
  const [error, setError] = useState('')
  const seen = useRef(new Set())

  const load = useCallback(async () => {
    if (!online || busy || document.hidden) return
    try {
      const response = await fetch(`${apiBase}/api/rider/offer`, { headers: authHeaders() })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) return
      setOffer(body.offer || null)
      if (body.offer && !seen.current.has(body.offer.deliveryId)) {
        seen.current.add(body.offer.deliveryId)
        try { navigator.vibrate?.([250, 120, 250]) } catch { /* not supported */ }
      }
    } catch { /* offline: try again on the next tick */ }
  }, [online, busy])

  useEffect(() => {
    if (!online || busy) { setOffer(null); return undefined }
    load()
    const poll = window.setInterval(load, 4000)
    document.addEventListener('visibilitychange', load)
    return () => { window.clearInterval(poll); document.removeEventListener('visibilitychange', load) }
  }, [online, busy, load])

  useEffect(() => {
    if (!offer) return undefined
    const tick = window.setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= new Date(offer.expiresAt).getTime()) setOffer((current) => (current?.deliveryId === offer.deliveryId ? null : current))
    }, 250)
    return () => window.clearInterval(tick)
  }, [offer])

  if (!offer) return null
  const left = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - now) / 1000))
  const share = Math.min(1, left / (offer.offerSeconds || 45))

  const respond = async (kind) => {
    setActing(kind); setError('')
    try {
      const response = await fetch(`${apiBase}/api/deliveries/${offer.deliveryId}/${kind}`, { method: 'POST', headers: authHeaders() })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || (kind === 'accept' ? 'This job is no longer available.' : 'Could not decline. Try again.'))
      setOffer(null)
      if (kind === 'accept') onAccepted?.()
    } catch (actionError) { setError(actionError.message); if (kind === 'accept') window.setTimeout(() => setOffer(null), 2500) } finally { setActing('') }
  }

  return <section className="ro-card" role="alertdialog" aria-labelledby="ro-title" aria-live="assertive">
    <div className="ro-top">
      <div>
        <span className="ro-kicker">NEW DELIVERY</span>
        <h2 id="ro-title">{offer.paidByBusiness ? 'Delivery for your business' : offer.earningMinor != null ? <>You earn <b>{formatNaira(offer.earningMinor / 100)}</b></> : 'New delivery request'}</h2>
        <p>{offer.tripKm != null ? `${offer.tripKm} km trip` : 'Trip in Sapele'}{offer.toStoreMeters != null ? ` · store ${(offer.toStoreMeters / 1000).toFixed(1)} km away` : ''}{offer.items ? ` · ${offer.items} item${offer.items === 1 ? '' : 's'}` : ''}</p>
      </div>
      <div className="ro-timer" style={{ '--share': share }} aria-label={`${left} seconds left to accept`}><span>{left}</span><small>sec</small></div>
    </div>
    <ol className="ro-route">
      <li><Store size={18} aria-hidden="true" /><span><small>Pick up</small><b>{offer.pickup.name}</b><em>{offer.pickup.address}</em></span></li>
      <li><MapPin size={18} aria-hidden="true" /><span><small>Drop off</small><b>{offer.dropoff.area || 'Customer'}</b><em>{offer.dropoff.address}</em></span></li>
    </ol>
    {error && <p className="ro-error" role="alert">{error}</p>}
    <div className="ro-actions">
      <button type="button" className="ro-decline" disabled={Boolean(acting)} onClick={() => respond('reject')}><X size={18} aria-hidden="true" />{acting === 'reject' ? 'Passing…' : 'Pass'}</button>
      <button type="button" className="ro-accept" disabled={Boolean(acting)} onClick={() => respond('accept')}><Bike size={18} aria-hidden="true" />{acting === 'accept' ? 'Accepting…' : 'Accept'}</button>
    </div>
    <p className="ro-note"><Clock3 size={13} aria-hidden="true" />If you don’t answer, it goes to the next rider. <Package size={13} aria-hidden="true" /> Order {offer.orderNumber}</p>
  </section>
}

/** Rider enters the customer's 4-digit code to finish a food delivery. */
export function DeliveryCodeSheet({ orderNumber, onSubmit, onClose }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await onSubmit(code) } catch (submitError) { setError(submitError.message); setBusy(false) }
  }
  return <>
    <div className="oa-backdrop" onClick={() => !busy && onClose()} aria-hidden="true" />
    <form className="oa-sheet ro-code" role="dialog" aria-modal="true" aria-labelledby="ro-code-title" onSubmit={submit}>
      <h2 id="ro-code-title">Ask for the delivery code</h2>
      <p>The customer sees a 4-digit code on their order {orderNumber}. Enter it to finish the delivery.</p>
      <input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4}" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))} aria-label="4-digit delivery code" placeholder="• • • •" />
      {error && <p className="oa-error" role="alert">{error}</p>}
      <div className="oa-buttons">
        <button type="submit" className="ro-accept" disabled={busy || code.length !== 4}>{busy ? 'Checking…' : 'Complete delivery'}</button>
        <button type="button" className="oa-keep" disabled={busy} onClick={onClose}>Not yet</button>
      </div>
      <small className="ro-help">Customer can’t find it? Call them, or chat with DOORSTEP Help so support can confirm it.</small>
    </form>
  </>
}

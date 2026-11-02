import { lazy, Suspense, useState } from 'react'
import { Check, MapPin } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Business › Business profile: pin the exact store entrance. Delivery fees are measured by road from this point,
// and riders are sent here to collect orders.
const MapPointPicker = lazy(() => import('../map/MapPointPicker').then((module) => ({ default: module.MapPointPicker })))
const targets = [{ key: 'store', label: 'Store location', shortLabel: 'store', badge: '', markerClass: 'is-pickup' }]

export function StoreLocationPin({ restaurant, onSaved }) {
  const pinned = restaurant?.latitude != null && restaurant?.longitude != null
  const [open, setOpen] = useState(false)
  const [points, setPoints] = useState(() => ({ store: pinned ? { latitude: Number(restaurant.latitude), longitude: Number(restaurant.longitude), label: restaurant.address, source: 'saved' } : null }))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const save = async () => {
    const point = points.store
    if (!point) return
    setBusy(true); setError(''); setMessage('')
    try {
      let token = null
      try { token = localStorage.getItem('doorstep-token') } catch { token = null }
      const response = await fetch(`${apiBase}/api/restaurant/location`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ latitude: point.latitude, longitude: point.longitude }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'The location could not be saved. Try again.')
      setMessage('Store location saved. Delivery fees now start from this spot.')
      setOpen(false)
      onSaved?.(body.restaurant)
    } catch (saveError) { setError(saveError.message) } finally { setBusy(false) }
  }
  return <section className={`store-pin${pinned ? ' is-pinned' : ''}`}>
    <span className="store-pin-icon" aria-hidden="true">{pinned ? <Check size={18} /> : <MapPin size={18} />}</span>
    <div>
      <b>{pinned ? 'Store location is pinned' : 'Pin your store on the map'}</b>
      <small>{pinned ? 'Customers’ delivery fees are measured by road from this point.' : 'Until you do, delivery fees are estimated from your area’s centre. Pin your entrance so every customer pays the right fee for their distance.'}</small>
      {message && <small className="store-pin-ok" role="status">{message}</small>}
      {error && <small className="store-pin-error" role="alert">{error}</small>}
    </div>
    <button type="button" className="portal-primary store-pin-btn" onClick={() => setOpen(true)}>{pinned ? 'Move pin' : 'Set location'}</button>
    {open && <div className="store-pin-layer" role="dialog" aria-modal="true" aria-label="Set store location">
      <div className="location-map-card delivery-map-experience map-picker-host">
        <Suspense fallback={<p role="status" style={{ padding: 24 }}>Loading the map…</p>}>
          <MapPointPicker targets={targets} value={points} onChange={setPoints} heading={{ kicker: 'YOUR STORE · SAPELE', title: 'Where is your store?', intro: 'Stand at your shop and tap GPS, or search and drag the pin to your entrance.' }} onClose={() => setOpen(false)} routeMode="none" savedPlaces={false}>
            <div className="map-picker-actions">
              <button className="primary-button map-picker-confirm" type="button" disabled={!points.store || busy} onClick={save}>{busy ? 'Saving…' : 'Save store location'}</button>
              {error && <p className="map-picker-message" role="alert">{error}</p>}
            </div>
          </MapPointPicker>
        </Suspense>
      </div>
    </div>}
  </section>
}

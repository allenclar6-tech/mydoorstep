import { useEffect, useState } from 'react'
import { apiBase } from '../config/apiBase'

const adminHeaders = () => { try { return { Authorization: `Bearer ${localStorage.getItem('doorstep-admin-token')}` } } catch { return {} } }
const toNaira = (minor) => (Number(minor || 0) / 100).toString()
const toMinor = (naira) => Math.round(Number(naira || 0) * 100)
const money = (minor) => `₦${(Math.round(minor) / 100).toLocaleString('en-NG')}`
const blankService = () => ({ code: '', name: '', description: '', vehicleTypes: ['Motorcycle'], enabled: true, baseFeeMinor: 0, perKmMinor: 0, minimumFareMinor: 0, maxPackageSize: 'MEDIUM' })

/**
 * Parcel fares are business decisions. Nothing is pre-filled: operations
 * enters the approved values, and every save is audited on the server.
 */
export function AdminParcels() {
  const [pricing, setPricing] = useState(null)
  const [routing, setRouting] = useState(null)
  const [bookings, setBookings] = useState([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    fetch(`${apiBase}/api/admin/parcel-pricing`, { headers: adminHeaders() }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load parcel pricing.'); setPricing(body.pricing); setRouting(body.routingConfigured) }).catch((error) => setMessage(error.message))
    fetch(`${apiBase}/api/admin/parcels`, { headers: adminHeaders() }).then((response) => response.ok ? response.json() : { bookings: [] }).then((body) => setBookings(body.bookings || [])).catch(() => undefined)
  }, [])
  const updateService = (index, patch) => setPricing((current) => ({ ...current, services: current.services.map((service, position) => position === index ? { ...service, ...patch } : service) }))
  const save = async (event) => {
    event.preventDefault()
    setSaving(true); setMessage('')
    try {
      const { approvedBy, invalidStoredSettings, ...payload } = pricing
      const response = await fetch(`${apiBase}/api/admin/parcel-pricing`, { method: 'PATCH', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message || body.error || 'Could not save parcel pricing.')
      setPricing(body.pricing); setRouting(body.routingConfigured)
      setMessage('Parcel pricing saved and audited.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }
  return <>
    <div className="admin-intro"><div><span className="section-kicker">PACKAGE DELIVERY</span><h2>Fares, services and bookings.</h2></div></div>
    {message && <div className="profile-message" role="status">{message}</div>}
    {routing === false && <div className="profile-message" role="alert">Road routing is not configured on the API host. Set the server-side Mapbox token before enabling package bookings; prices are never estimated from straight-line distance.</div>}
    {!pricing ? <div className="empty-state">Loading parcel pricing…</div> : <form className="admin-table" onSubmit={save}>
      <section className="admin-panel">
        <h3>Availability</h3>
        <label className="admin-check"><input type="checkbox" checked={pricing.enabled} onChange={(event) => setPricing({ ...pricing, enabled: event.target.checked })} /> Accept package bookings</label>
        <p>Customers only see prices calculated by the server from these approved values and a real road route.</p>
        {pricing.approvedBy && <small>Last saved by {pricing.approvedBy}.</small>}
      </section>
      <section className="admin-panel">
        <h3>Services</h3>
        {pricing.services.length === 0 && <p>No services yet. Add the delivery services DOORSTEP offers, with approved fares.</p>}
        {pricing.services.map((service, index) => <fieldset key={index} className="admin-parcel-service">
          <label>Code<input value={service.code} onChange={(event) => updateService(index, { code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} placeholder="BIKE" required /></label>
          <label>Name<input value={service.name} onChange={(event) => updateService(index, { name: event.target.value })} placeholder="Bike delivery" required /></label>
          <label>Description<input value={service.description} onChange={(event) => updateService(index, { description: event.target.value })} /></label>
          <label>Vehicle types (comma separated)<input value={service.vehicleTypes.join(', ')} onChange={(event) => updateService(index, { vehicleTypes: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
          <label>Base fare (₦)<input type="number" min="0" step="1" value={toNaira(service.baseFeeMinor)} onChange={(event) => updateService(index, { baseFeeMinor: toMinor(event.target.value) })} required /></label>
          <label>Per km (₦)<input type="number" min="0" step="1" value={toNaira(service.perKmMinor)} onChange={(event) => updateService(index, { perKmMinor: toMinor(event.target.value) })} required /></label>
          <label>Minimum fare (₦)<input type="number" min="0" step="1" value={toNaira(service.minimumFareMinor)} onChange={(event) => updateService(index, { minimumFareMinor: toMinor(event.target.value) })} required /></label>
          <label>Largest package<select value={service.maxPackageSize} onChange={(event) => updateService(index, { maxPackageSize: event.target.value })}><option value="SMALL">Small</option><option value="MEDIUM">Medium</option><option value="LARGE">Large</option></select></label>
          <label className="admin-check"><input type="checkbox" checked={service.enabled} onChange={(event) => updateService(index, { enabled: event.target.checked })} /> Enabled</label>
          <button type="button" className="quiet-button" onClick={() => setPricing({ ...pricing, services: pricing.services.filter((_item, position) => position !== index) })}>Remove</button>
        </fieldset>)}
        <button type="button" className="quiet-button" onClick={() => setPricing({ ...pricing, services: [...pricing.services, blankService()] })}>Add service</button>
      </section>
      <section className="admin-panel">
        <h3>Service fee</h3>
        <label>Type<select value={pricing.serviceFee.type} onChange={(event) => setPricing({ ...pricing, serviceFee: { ...pricing.serviceFee, type: event.target.value } })}><option value="NONE">None</option><option value="FLAT">Flat amount</option><option value="PERCENT">Percentage of fare</option></select></label>
        {pricing.serviceFee.type === 'FLAT' && <label>Flat fee (₦)<input type="number" min="0" value={toNaira(pricing.serviceFee.flatMinor)} onChange={(event) => setPricing({ ...pricing, serviceFee: { ...pricing.serviceFee, flatMinor: toMinor(event.target.value) } })} /></label>}
        {pricing.serviceFee.type === 'PERCENT' && <label>Percent (0–30)<input type="number" min="0" max="30" step="0.5" value={pricing.serviceFee.percent} onChange={(event) => setPricing({ ...pricing, serviceFee: { ...pricing.serviceFee, percent: Number(event.target.value) } })} /></label>}
      </section>
      <section className="admin-panel">
        <h3>Service area</h3>
        <p>Pickup and destination must both be inside this radius. Leave the radius empty to accept any location in Nigeria that has a road route.</p>
        <label>Centre latitude<input type="number" step="0.000001" value={pricing.serviceArea.centerLatitude} onChange={(event) => setPricing({ ...pricing, serviceArea: { ...pricing.serviceArea, centerLatitude: Number(event.target.value) } })} /></label>
        <label>Centre longitude<input type="number" step="0.000001" value={pricing.serviceArea.centerLongitude} onChange={(event) => setPricing({ ...pricing, serviceArea: { ...pricing.serviceArea, centerLongitude: Number(event.target.value) } })} /></label>
        <label>Radius (km)<input type="number" min="0" step="0.5" value={pricing.serviceArea.radiusKm ?? ''} onChange={(event) => setPricing({ ...pricing, serviceArea: { ...pricing.serviceArea, radiusKm: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
        <label>Maximum road distance (km)<input type="number" min="0" step="0.5" value={pricing.maxRouteDistanceKm ?? ''} onChange={(event) => setPricing({ ...pricing, maxRouteDistanceKm: event.target.value === '' ? null : Number(event.target.value) })} /></label>
      </section>
      <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save parcel pricing'}</button>
    </form>}
    <section className="admin-table">
      <h3>Recent package bookings</h3>
      {bookings.length === 0 ? <div className="empty-state">No package bookings yet.</div> : bookings.map((booking) => <div className="admin-row" key={booking.id}>
        <strong>{booking.reference}</strong>
        <span>{booking.customer ? `${booking.customer.firstName} ${booking.customer.lastName}` : ''}</span>
        <span>{booking.pickup.address} → {booking.dropoff.address}</span>
        <span>{money(booking.price.totalMinor)} · {booking.payment?.status || 'no payment'}</span>
        <span className="portal-status">{booking.statusLabel}</span>
      </div>)}
    </section>
  </>
}

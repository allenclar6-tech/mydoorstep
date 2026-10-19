import { useState } from 'react'
import { MapPointPicker } from './map/MapPointPicker'
import { readConfirmedLocation } from './location'

const deliveryTargets = [{ key: 'delivery', label: 'Delivery point', shortLabel: 'delivery address', badge: '', markerClass: 'is-dropoff' }]

/**
 * Food-delivery location picker. Keeps the original contract: the confirmed
 * point is stored as `doorstep-location-coordinates` and passed to onSelect.
 */
export function LocationMap({ onSelect, onCancel }) {
  const [points, setPoints] = useState(() => ({ delivery: readConfirmedLocation() }))
  const [confirmed, setConfirmed] = useState('')
  const point = points.delivery

  const confirmLocation = () => {
    if (!point) return
    const confirmedLocation = { latitude: point.latitude, longitude: point.longitude, label: point.label, source: point.source, accuracyMeters: point.accuracyMeters ?? null }
    try { localStorage.setItem('doorstep-location-coordinates', JSON.stringify(confirmedLocation)) } catch { /* the parent also receives the point */ }
    window.dispatchEvent(new Event('doorstep-location-change'))
    setConfirmed('Delivery location confirmed.')
    onSelect(confirmedLocation)
  }

  return <div className="location-map-card delivery-map-experience map-picker-host">
    <MapPointPicker
      targets={deliveryTargets}
      value={points}
      onChange={(next) => { setPoints(next); setConfirmed('') }}
      heading={{ kicker: 'DOORSTEP DELIVERY · SAPELE', title: 'Set your delivery point', intro: 'Search an address, use GPS, or tap the map to place your doorstep pin.' }}
      onClose={onCancel}
      routeMode="fromCenter"
    >
      <div className="map-picker-actions">
        <button className="primary-button map-picker-confirm" type="button" disabled={!point} onClick={confirmLocation}>Confirm delivery location</button>
        {confirmed && <p className="map-picker-message" role="status">{confirmed}</p>}
      </div>
    </MapPointPicker>
  </div>
}

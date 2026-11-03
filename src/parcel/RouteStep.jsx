import { useEffect, useState } from 'react'
import { ArrowDownUp, ArrowLeft, ArrowRight, ChevronRight, Clock3, ShieldCheck, Truck } from 'lucide-react'
import { CenterPinMap } from '../map/CenterPinMap'
import { useMapToken } from '../map/mapCore'
import { Parcel } from '../shop/Illustrations'
import { api } from './api'

// Glovo-style first step of “Send a package”: a Pick-up (A) / Drop-off (B) card joined by a dotted line, a swap
// button and a map preview. Tapping a row opens the full-screen centre-pin map. Prices are worked out by the
// server on the next steps — nothing here guesses a fare.

const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const COPY = {
  pickup: { tone: 'a', title: 'Pick-up', empty: 'Where should the rider collect it?', kicker: 'Pick-up point', prompt: 'Put the pin where the rider collects it', confirm: 'Set pick-up here' },
  dropoff: { tone: 'b', title: 'Drop-off', empty: 'Where is it going?', kicker: 'Drop-off point', prompt: 'Put the pin where it should be delivered', confirm: 'Set drop-off here' },
}

function previewUrl(points, mapToken) {
  if (!mapToken) return null
  const pins = [['pickup', 'a', '2563eb'], ['dropoff', 'b', 'e0562b']].filter(([key]) => points[key]).map(([key, letter, colour]) => `pin-l-${letter}+${colour}(${points[key].longitude.toFixed(6)},${points[key].latitude.toFixed(6)})`)
  if (!pins.length) return null
  const view = pins.length === 2 ? 'auto' : `${(points.pickup || points.dropoff).longitude.toFixed(6)},${(points.pickup || points.dropoff).latitude.toFixed(6)},15.5,0`
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pins.join(',')}/${view}/720x320@2x?padding=60&access_token=${encodeURIComponent(mapToken)}`
}

/** points: { pickup, dropoff } each { latitude, longitude, label, source } or null. */
export function RouteStep({ points, onChange, onContinue, samePlace, notices }) {
  const [editing, setEditing] = useState(null)
  const [places, setPlaces] = useState([])
  const [noMap, setNoMap] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const { token: mapToken } = useMapToken()
  useEffect(() => {
    api('/api/addresses').then((body) => setPlaces((body.addresses || []).filter((entry) => entry.latitude != null && entry.longitude != null).map((entry) => ({ id: entry.id, label: entry.label, addressLine: entry.addressLine, latitude: Number(entry.latitude), longitude: Number(entry.longitude) })))).catch(() => undefined)
  }, [])
  useEffect(() => { setPreviewFailed(false) }, [points.pickup?.latitude, points.dropoff?.latitude])

  if (editing) {
    const copy = COPY[editing]
    return <CenterPinMap key={editing} tone={copy.tone} kicker={copy.kicker} prompt={copy.prompt} confirmLabel={copy.confirm} hint="Drag the map so the pin sits on the exact gate or shop front." start={points[editing]} places={places}
      onBack={() => setEditing(null)} onNoMap={() => { setNoMap(true); setEditing(null) }}
      onConfirm={({ latitude, longitude, label }) => { onChange({ ...points, [editing]: { latitude, longitude, label, source: 'map' } }); setEditing(null) }} />
  }

  const swap = () => onChange({ pickup: points.dropoff, dropoff: points.pickup })
  const preview = previewFailed ? null : previewUrl(points, mapToken)
  const ready = points.pickup && points.dropoff && !samePlace
  return <div className="sp-screen pk-page">
    <header className="pk-header"><button type="button" className="cd-back" onClick={() => navigate('/')} aria-label="Back"><ArrowLeft size={20} /></button><h1>Send a package</h1><button type="button" className="pk-link" onClick={() => navigate('/parcels')}>My packages</button></header>
    <main className="sp-body pk-body">
      <section className="pk-hero"><span className="pk-hero-art" aria-hidden="true"><Parcel /></span><div><h2>Anything, anywhere in town</h2><p>A rider collects it and brings it straight to the door. You see the price before you pay.</p></div></section>
      {notices}
      <section className="pk-route" aria-label="Route">
        {['pickup', 'dropoff'].map((key, index) => {
          const point = points[key]
          return <button key={key} type="button" className={`pk-stop is-${COPY[key].tone}${point ? ' is-set' : ''}`} onClick={() => setEditing(key)} disabled={noMap}>
            <i className="pk-dot" aria-hidden="true">{COPY[key].tone.toUpperCase()}</i>
            <span><small>{COPY[key].title}</small><b>{point ? point.label.split(',').slice(0, 2).join(',') : COPY[key].empty}</b>{point && point.label.split(',').length > 2 && <em>{point.label.split(',').slice(2).join(',').trim()}</em>}</span>
            <ChevronRight size={18} aria-hidden="true" />
            {index === 0 && <span className="pk-line" aria-hidden="true" />}
          </button>
        })}
        <button type="button" className="pk-swap" onClick={swap} disabled={!points.pickup && !points.dropoff} aria-label="Swap pick-up and drop-off"><ArrowDownUp size={18} /></button>
      </section>
      {noMap && <p className="cd-note is-warn">The map isn’t available right now, so package bookings can’t be placed. Please try again later.</p>}
      {samePlace && <p className="cd-error" role="alert">Pick-up and drop-off are the same spot. Move one of the pins.</p>}
      {(points.pickup || points.dropoff) && <div className="pk-preview">{preview ? <img src={preview} alt="Map showing your pick-up and drop-off" onError={() => setPreviewFailed(true)} /> : <div className="pk-preview-plain"><Truck size={26} aria-hidden="true" /><span>{points.pickup && points.dropoff ? 'Both points are set' : 'Add the other point'}</span></div>}</div>}
      <ul className="pk-points">
        <li><ShieldCheck size={18} aria-hidden="true" /><span><b>Price before you pay</b><small>Worked out by road distance on the next step.</small></span></li>
        <li><Clock3 size={18} aria-hidden="true" /><span><b>Track it live</b><small>Follow the rider on the map until it’s delivered.</small></span></li>
      </ul>
      <div className="pk-actions"><button type="button" className="sp-primary" disabled={!ready} onClick={onContinue}>{!points.pickup ? 'Set the pick-up point' : !points.dropoff ? 'Set the drop-off point' : <>Continue <ArrowRight size={18} aria-hidden="true" /></>}</button></div>
    </main>
  </div>
}

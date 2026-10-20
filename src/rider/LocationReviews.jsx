import { useEffect, useState } from 'react'
import { MapPin, Send } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { LocationsMap, STATUS_COLORS } from '../admin/LocationsMap'

// Rider › Local checks: riders who know Sapele confirm names, pins and landmarks. A submission is only a report —
// an authorised reviewer must accept it, and only then does it count as evidence. Nothing here verifies a place.

const token = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
const blank = { confirmationType: '', nameConfirmed: true, suggestedName: '', landmark: '', notes: '' }

export function LocationReviews() {
  const [locations, setLocations] = useState(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState(blank)
  const [pin, setPin] = useState(null)
  const [placing, setPlacing] = useState(false)
  const [done, setDone] = useState('')
  const load = () => fetch(`${apiBase}/api/locations/review-queue`, { headers: { Authorization: `Bearer ${token()}` } }).then(async (response) => {
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.message || 'Could not load places to check.')
    setLocations(body.locations || [])
  }).catch((loadError) => setError(loadError.message))
  useEffect(() => { load() }, [])
  useEffect(() => { setForm(blank); setPin(null); setPlacing(false); setDone(''); setError('') }, [selectedId])
  const selected = locations?.find((row) => row.id === selectedId)

  const submit = async () => {
    setError('')
    if (!form.confirmationType) { setError('Say whether you checked on site or remotely.'); return }
    try {
      const response = await fetch(`${apiBase}/api/locations/${selectedId}/reviews`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmationType: form.confirmationType, nameConfirmed: form.nameConfirmed, notes: form.notes, ...(form.suggestedName ? { suggestedName: form.suggestedName } : {}), ...(form.landmark ? { landmark: form.landmark } : {}), ...(pin ? { suggestedLatitude: pin.latitude, suggestedLongitude: pin.longitude } : {}) }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Could not send your check.')
      setDone(`Thanks — your check of ${selected.name} was sent for review.`); setForm(blank); setPin(null); setPlacing(false)
    } catch (submitError) { setError(submitError.message) }
  }

  return <section className="la">
    <div className="la-card">
      <span className="la-kicker">LOCAL CHECKS</span>
      <h2 style={{ margin: 0 }}>Help us map Sapele correctly</h2>
      <p className="la-muted">These places are not confirmed yet. If you know one, tell us its correct name, where it really is, and a landmark people use. Only report what you know — a reviewer checks every submission.</p>
    </div>
    {error && <p className="la-error" role="alert">{error}</p>}
    {done && <p className="la-ok" role="status">{done}</p>}
    {!locations ? <div className="la-card la-muted">Loading…</div> : <>
      <LocationsMap locations={locations} selectedId={selectedId} onSelect={setSelectedId} mode={placing ? 'pin' : 'view'} draftPin={pin} onPin={(point) => { setPin(point); setPlacing(false) }} height={300} />
      {selected && <div className="la-card">
        <div><h3 style={{ margin: 0 }}>{selected.name}</h3>{selected.alternativeNames?.length > 0 && <small className="la-muted">Also spelled: {selected.alternativeNames.join(', ')}</small>}</div>
        {selected.question && <p className="la-notes">{selected.question}</p>}
        <p className="la-muted">{selected.latitude != null ? 'The pin on the map is our current best guess and may be wrong.' : 'We have no pin for this place yet.'}</p>
        <div className="lr-choice" role="group" aria-label="How did you check?">
          <button type="button" className={form.confirmationType === 'PHYSICAL' ? 'is-on' : ''} onClick={() => setForm({ ...form, confirmationType: 'PHYSICAL' })}>I am there / went there</button>
          <button type="button" className={form.confirmationType === 'REMOTE' ? 'is-on' : ''} onClick={() => setForm({ ...form, confirmationType: 'REMOTE' })}>I know it / asked someone local</button>
        </div>
        <label className="la-check"><input type="checkbox" checked={form.nameConfirmed} onChange={(event) => setForm({ ...form, nameConfirmed: event.target.checked })} />“{selected.name}” is the right name</label>
        <div className="la-grid">
          {!form.nameConfirmed && <label className="la-wide">What people actually call it<input value={form.suggestedName} onChange={(event) => setForm({ ...form, suggestedName: event.target.value })} /></label>}
          <label className="la-wide">Landmark people use<input value={form.landmark} onChange={(event) => setForm({ ...form, landmark: event.target.value })} placeholder="e.g. opposite the primary school" /></label>
          <label className="la-wide">What you checked<textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="e.g. Delivered there last week; the junction off Amukpe road is the entrance." /></label>
        </div>
        <div className="la-row">
          <button type="button" className="la-ghost" onClick={() => setPlacing(!placing)}><MapPin size={14} />{placing ? 'Tap the map…' : pin ? 'Move my pin' : 'Show the right spot on the map'}</button>
          {pin && <span className="la-muted">{pin.latitude}, {pin.longitude} <button type="button" className="la-link" onClick={() => setPin(null)}>Remove</button></span>}
        </div>
        <button type="button" className="la-primary" onClick={submit}><Send size={14} />Send for review</button>
      </div>}
      <ul className="lr-list">{locations.map((row) => <li key={row.id}><button type="button" className={row.id === selectedId ? 'is-on' : ''} onClick={() => setSelectedId(row.id)}>
        <span className="la-dot" style={{ background: STATUS_COLORS[row.status] }} />
        <span className="la-list-main"><b>{row.name}</b><small>{row.latitude == null ? 'No pin yet' : 'Pin needs checking'}{row.alternativeNames?.length ? ` · also ${row.alternativeNames.slice(0, 2).join(', ')}` : ''}</small></span>
      </button></li>)}{locations.length === 0 && <li className="la-muted">Nothing to check right now.</li>}</ul>
    </>}
  </section>
}

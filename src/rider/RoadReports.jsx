import { useCallback, useEffect, useState } from 'react'
import { LocateFixed, RefreshCw } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import './priceChecks.css'

// Rider › Road reports: tell DOORSTEP what the map doesn't know. A manager reviews each report; approved ones help
// price deliveries to hard-to-map places fairly.

const token = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
const STATUS_TEXT = { PENDING: 'Waiting for review', APPROVED: 'Approved', REJECTED: 'Not approved' }
const KINDS = [['ROAD_CONDITION', 'Road condition'], ['CLOSURE', 'Road closed'], ['ACCESS', 'Access problem (gate, bridge, river)'], ['DISTANCE', 'Real distance'], ['LANDMARK', 'Landmark / directions'], ['EXTRA_CHARGE', 'Extra charge needed']]

export function RoadReports() {
  const [form, setForm] = useState({ kind: 'ROAD_CONDITION', area: '', note: '', distanceKm: '', extraCharge: '', orderNumber: '' })
  const [location, setLocation] = useState(null)
  const [state, setState] = useState({ busy: false, error: '', ok: '' })
  const [mine, setMine] = useState(null)
  const load = useCallback(() => fetch(`${apiBase}/api/rider/road-reports`, { headers: { Authorization: `Bearer ${token()}` } }).then((response) => response.ok ? response.json() : null).then((body) => setMine(body?.reports || [])).catch(() => setMine([])), [])
  useEffect(() => { load() }, [load])
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const locate = () => {
    if (!navigator.geolocation) { setState({ busy: false, error: 'Your phone can’t share its location here.', ok: '' }); return }
    navigator.geolocation.getCurrentPosition((position) => setLocation({ latitude: Math.round(position.coords.latitude * 1e6) / 1e6, longitude: Math.round(position.coords.longitude * 1e6) / 1e6 }), () => setState({ busy: false, error: 'Location wasn’t shared. You can still send the report.', ok: '' }), { enableHighAccuracy: true, timeout: 15000 })
  }
  const submit = async (event) => {
    event.preventDefault()
    setState({ busy: true, error: '', ok: '' })
    const body = { kind: form.kind, area: form.area, note: form.note, ...(form.orderNumber.trim() ? { orderNumber: form.orderNumber.trim() } : {}), ...(location ? { location } : {}), ...(form.distanceKm ? { distanceKm: Number(form.distanceKm) } : {}), ...(form.extraCharge ? { extraChargeMinor: Math.round(Number(form.extraCharge) * 100) } : {}) }
    try {
      const response = await fetch(`${apiBase}/api/rider/road-reports`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const answer = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(answer.message || 'Your report wasn’t sent. Try again.')
      setState({ busy: false, error: '', ok: 'Thanks. A DOORSTEP manager will review it.' })
      setForm({ kind: form.kind, area: '', note: '', distanceKm: '', extraCharge: '', orderNumber: '' }); setLocation(null); load()
    } catch (error) { setState({ busy: false, error: error instanceof TypeError ? 'No internet. Your report wasn’t sent.' : error.message, ok: '' }) }
  }

  return <section className="pc" aria-labelledby="rr-title">
    <header className="pc-intro"><div><h2 id="rr-title">Road reports</h2><p>Tell DOORSTEP about bad roads, closures, gates, real distances and good landmarks. Approved reports help set fair prices for places the map gets wrong.</p></div></header>
    <form className="pc-card pc-form" onSubmit={submit}>
      <label>What are you reporting?<select value={form.kind} onChange={(event) => set('kind', event.target.value)}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Area, street or landmark<input required minLength={2} maxLength={120} value={form.area} onChange={(event) => set('area', event.target.value)} placeholder="e.g. Amukpe, after the Anglican church" /></label>
      <label>What’s it like?<input required minLength={5} maxLength={500} value={form.note} onChange={(event) => set('note', event.target.value)} placeholder="e.g. Untarred 2 km, floods when it rains" /></label>
      {form.kind === 'DISTANCE' && <label>Real distance from the store (km)<input inputMode="decimal" value={form.distanceKm} onChange={(event) => set('distanceKm', event.target.value.replace(/[^\d.]/g, '').slice(0, 5))} placeholder="e.g. 6.5" /></label>}
      {form.kind === 'EXTRA_CHARGE' && <label>Extra you think is fair (₦)<input inputMode="numeric" value={form.extraCharge} onChange={(event) => set('extraCharge', event.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="e.g. 500" /></label>}
      <label>Order number (optional)<input maxLength={40} value={form.orderNumber} onChange={(event) => set('orderNumber', event.target.value)} placeholder="If it happened on a job" /></label>
      <div className="pc-actions">
        <button type="button" className="pc-btn" onClick={locate}><LocateFixed size={16} />{location ? 'Location added' : 'Add my location'}</button>
        <button type="submit" className="pc-btn is-primary" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send report'}</button>
      </div>
      {state.ok && <p className="pc-mine" role="status">{state.ok}</p>}
      {state.error && <p className="pc-error" role="alert">{state.error}</p>}
    </form>

    <header className="pc-intro"><div><h2>Your reports</h2></div><button type="button" className="pc-btn is-icon" onClick={load} aria-label="Refresh"><RefreshCw size={17} /></button></header>
    {mine && !mine.length && <div className="pc-empty"><b>No reports yet</b><p>Your reports and their review status show here.</p></div>}
    {mine?.map((report) => <article key={report.id} className="pc-card">
      <header className="pc-card-head"><span className="pc-order">{report.kindText}</span><time dateTime={report.at}>{new Date(report.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time></header>
      <p className="pc-route-text"><b>{report.area}</b><br />{report.note}</p>
      <p className={report.status === 'PENDING' ? 'pc-note' : `pc-mine is-${report.status === 'REJECTED' ? 'decline' : 'agree'}`}>{STATUS_TEXT[report.status]}{report.reviewNote ? ` · ${report.reviewNote}` : ''}</p>
    </article>)}
  </section>
}

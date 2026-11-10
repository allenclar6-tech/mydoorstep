import { useCallback, useEffect, useState } from 'react'
import { Check, MapPin, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import './merchantDeals.css'

// Admin › Road reports: approve or reject what riders report about roads, access, distances and landmarks.
// Approved reports appear as suggestions when you set prices for hard-to-map places (with their age and how many
// riders agree). They're never treated as permanently true: after 90 days they're marked as old.

const headers = () => { let token = null; try { token = localStorage.getItem('doorstep-admin-token') } catch { token = null } return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
const LEVEL_TEXT = { NONE: 'No other rider has confirmed this', LOW: '1 rider agrees (approved)', MEDIUM: '2 riders agree', HIGH: '3 or more riders agree' }
const when = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function RoadReportsAdmin() {
  const [tab, setTab] = useState('PENDING')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState('')
  const load = useCallback(() => {
    setData(null); setError('')
    fetch(`${apiBase}/api/admin/road-reports?status=${tab}`, { headers: headers() }).then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(response.status === 403 ? 'Your role can’t review road reports.' : 'Couldn’t load road reports.'); setData(body) }).catch((loadError) => setError(loadError.message))
  }, [tab])
  useEffect(() => { load() }, [load])
  const review = async (report, decision) => {
    setBusy(report.id)
    try {
      const response = await fetch(`${apiBase}/api/admin/road-reports/${report.id}/review`, { method: 'POST', headers: headers(), body: JSON.stringify({ decision, ...(notes[report.id]?.trim() ? { note: notes[report.id].trim() } : {}) }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'That didn’t work. Try again.')
      load()
    } catch (reviewError) { setError(reviewError.message) } finally { setBusy('') }
  }
  return <div className="md">
    <div className="ov-seg" role="tablist">{[['PENDING', 'To review'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([value, label]) => <button key={value} type="button" role="tab" aria-pressed={tab === value} aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
    {error && <p className="md-alert" role="alert">{error}</p>}
    {!data && !error && <div className="md-skeleton" role="status" aria-label="Loading"><span /><span /></div>}
    {data && !data.reports.length && <p className="md-muted">{tab === 'PENDING' ? 'Nothing to review.' : 'None yet.'}</p>}
    {data?.reports.map((report) => <article key={report.id} className="md-card">
      <header className="md-card-head">
        <div><h3>{report.kindText} · {report.area}</h3><p>{report.rider ? `${report.rider.name}${report.rider.rating != null ? ` · ★ ${report.rider.rating.toFixed(1)}` : ''}${report.rider.phone ? ` · ${report.rider.phone}` : ''}` : 'Rider'} · {when(report.at)}</p></div>
        {report.stale ? <span className="md-pill is-off">Over 90 days old</span> : <span className={`md-pill ${report.agreement.level === 'NONE' ? 'is-off' : 'is-on'}`}>{LEVEL_TEXT[report.agreement.level]}</span>}
      </header>
      <p className="md-note">{report.note}</p>
      <div className="md-facts">
        {report.distanceKm != null && <span>Real distance: <b>{report.distanceKm} km</b></span>}
        {report.extraChargeMinor != null && <span>Suggested extra: <b>₦{(report.extraChargeMinor / 100).toLocaleString('en-NG')}</b></span>}
        {report.location && <a href={`https://www.google.com/maps/search/?api=1&query=${report.location.latitude},${report.location.longitude}`} target="_blank" rel="noreferrer"><MapPin size={14} aria-hidden="true" />Open the spot in Maps</a>}
      </div>
      {report.status === 'PENDING' ? <div className="md-review">
        <input maxLength={300} value={notes[report.id] || ''} onChange={(event) => setNotes({ ...notes, [report.id]: event.target.value })} placeholder="Note to the rider (optional)" aria-label="Note to the rider" />
        <button type="button" className="md-btn is-primary" disabled={busy === report.id} onClick={() => review(report, 'APPROVED')}><Check size={16} />Approve</button>
        <button type="button" className="md-btn" disabled={busy === report.id} onClick={() => review(report, 'REJECTED')}><X size={16} />Reject</button>
      </div> : report.reviewNote && <p className="md-muted">Review note: {report.reviewNote}</p>}
    </article>)}
    <p className="md-muted">Approved distance reports and extra-charge suggestions show up when you set a price in “Prices to confirm”. To charge for a hard-to-reach area every time, add a difficult-access charge to that area in Delivery prices.</p>
  </div>
}

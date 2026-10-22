import { useCallback, useEffect, useRef, useState } from 'react'
import { Bike, MapPin, RefreshCw, Store } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { formatNaira } from '../data'
import { playAlert } from '../notifications/sound'

// Open food jobs every online rider can take (first to accept gets it). Shown on the rider dashboard under the
// personal job offer, and as the full "Jobs" page. New jobs ring like an offer so riders notice them.

const authHeaders = () => { let token = null; try { token = localStorage.getItem('doorstep-token') } catch { token = null } return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
const REFRESH_MS = 8000
const REASONS = {
  RIDER_NOT_AVAILABLE: 'Go online first (switch at the top of your dashboard), then accept.',
  RIDER_HAS_ACTIVE_DELIVERY: 'Finish your current delivery before taking another one.',
  DELIVERY_ALREADY_CLAIMED: 'Another rider took this job a moment ago.',
  DELIVERY_RESERVED_FOR_ANOTHER_RIDER: 'This job is being offered to another rider right now. If they pass, it comes back here.',
  BUSINESS_RIDER_DELIVERY_FORBIDDEN: 'This job belongs to another business’s own riders.',
}

export function OpenJobs({ online, approved, busy, onAccepted, title = 'Open jobs near you', showWhenEmpty = true }) {
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState('')
  const [acting, setActing] = useState('')
  const [notes, setNotes] = useState({})
  const [checkedAt, setCheckedAt] = useState(null)
  const known = useRef(null)

  const load = useCallback(async () => {
    if (document.hidden) return
    try {
      const response = await fetch(`${apiBase}/api/rider/deliveries`, { headers: authHeaders() })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error === 'RIDER_ROLE_REQUIRED' ? 'Sign in with your rider account to see jobs.' : 'Could not load jobs. Retrying…')
      const open = (body.deliveries || []).filter((item) => item.status === 'AVAILABLE' && !item.riderId && item.order)
      const ids = open.map((item) => item.id)
      if (known.current && online && !busy && ids.some((id) => !known.current.has(id))) playAlert('job')
      known.current = new Set(ids)
      setJobs(open); setError(''); setCheckedAt(Date.now())
    } catch (loadError) { setError(loadError instanceof TypeError ? 'No connection. Retrying…' : loadError.message) }
  }, [online, busy])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    document.addEventListener('visibilitychange', load)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', load) }
  }, [load])

  const accept = async (job) => {
    setActing(job.id); setNotes((current) => ({ ...current, [job.id]: '' }))
    try {
      const response = await fetch(`${apiBase}/api/deliveries/${job.id}/claim`, { method: 'POST', headers: authHeaders() })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw Object.assign(new Error(REASONS[body.error] || body.message || 'Could not accept this job. Try again.'), { code: body.error })
      onAccepted?.(job)
      load()
    } catch (acceptError) {
      setNotes((current) => ({ ...current, [job.id]: acceptError instanceof TypeError ? 'No connection. The job was not accepted — try again.' : acceptError.message }))
      if (['DELIVERY_ALREADY_CLAIMED'].includes(acceptError.code)) window.setTimeout(load, 1500)
    } finally { setActing('') }
  }

  const list = jobs || []
  if (!showWhenEmpty && list.length === 0 && !error) return null
  const blocked = !approved ? 'Your rider account is waiting for approval. You can see jobs, but accepting starts once DOORSTEP approves you.' : !online ? 'You’re offline. Go online to accept these jobs.' : busy ? 'Finish your current delivery to take another job.' : ''

  return <section className="oj" aria-labelledby="oj-title">
    <header className="oj-head">
      <div><h3 id="oj-title">{title}</h3><small>{jobs ? `${list.length} open · ${checkedAt ? 'updates every few seconds' : ''}` : 'Checking…'}</small></div>
      <button type="button" className="oj-refresh" onClick={load} aria-label="Refresh jobs"><RefreshCw size={16} /></button>
    </header>
    {blocked && <p className="oj-blocked">{blocked}</p>}
    {error && <p className="oj-error" role="alert">{error}</p>}
    {jobs && list.length === 0 && !error && <p className="oj-empty"><Bike size={18} aria-hidden="true" />{online ? 'No open jobs right now. Stay online — new jobs ring on this page.' : 'No open jobs right now.'}</p>}
    <ul className="oj-list">{list.map((job) => {
      const earning = job.earning?.amountMinor != null ? `You earn ${formatNaira(job.earning.amountMinor / 100)}` : job.earning?.paidByBusiness ? 'Paid by your business' : 'Pay shown after delivery'
      return <li key={job.id} className="oj-job">
        <div className="oj-top"><b>{earning}</b><span>{job.earning?.km != null ? `${job.earning.km} km trip` : 'Sapele trip'}</span></div>
        <ol className="oj-route">
          <li><Store size={16} aria-hidden="true" /><span><small>Pick up · {job.order.orderNumber}</small><b>{job.order.restaurant?.name}</b><em>{job.order.restaurant?.address}</em></span></li>
          <li><MapPin size={16} aria-hidden="true" /><span><small>Drop off</small><b>{job.order.addressSnapshot}</b>{job.order.landmarkSnapshot && <em>Landmark: {job.order.landmarkSnapshot}</em>}</span></li>
        </ol>
        {job.order.status === 'READY_FOR_PICKUP' ? <p className="oj-ready">Food is packed and waiting</p> : <p className="oj-prep">Being prepared — head over when you accept</p>}
        {notes[job.id] && <p className="oj-error" role="alert">{notes[job.id]}</p>}
        <button type="button" className="oj-accept" disabled={Boolean(acting) || Boolean(blocked)} onClick={() => accept(job)}>{acting === job.id ? 'Accepting…' : 'Accept job'}</button>
      </li>
    })}</ul>
  </section>
}

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bike, CheckCircle2, RefreshCw, Send } from 'lucide-react'
import { apiBase } from '../config/apiBase'

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const waited = (since) => { const minutes = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60_000)); return minutes < 1 ? 'just now' : `${minutes} min` }

/** Orders the business accepted that still have no rider, with one-tap re-dispatch. */
export function DispatchBoard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState({})
  const load = useCallback(async () => {
    try { setData(await call('/api/admin/dispatch')); setError('') } catch (loadError) { setError(loadError.message) }
  }, [])
  useEffect(() => { load(); const timer = window.setInterval(load, 10_000); return () => window.clearInterval(timer) }, [load])
  const [pick, setPick] = useState({})
  const sendTo = async (deliveryId) => {
    const riderId = pick[deliveryId]
    if (!riderId) { setNote({ [deliveryId]: 'Choose a rider first.' }); return }
    try { await call(`/api/admin/deliveries/${deliveryId}/offer`, { method: 'POST', body: { riderId } }); setNote({ [deliveryId]: 'Sent. The rider has 2 minutes to accept it on their dashboard.' }); load() } catch (sendError) { setNote({ [deliveryId]: sendError.message }) }
  }
  const retry = async (deliveryId) => {
    try { const result = await call(`/api/admin/deliveries/${deliveryId}/dispatch`, { method: 'POST' }); setNote({ [deliveryId]: result.offered ? 'Offered to the nearest free rider.' : result.message }); load() } catch (retryError) { setNote({ [deliveryId]: retryError.message }) }
  }
  return <section className="db" aria-labelledby="db-title">
    <header><div><h3 id="db-title">Waiting for a rider</h3><p>{data ? `${data.onlineRiders} rider${data.onlineRiders === 1 ? '' : 's'} online · ${data.freeRiders} free` : 'Loading…'}</p></div><button type="button" className="db-icon" onClick={load} aria-label="Refresh"><RefreshCw size={16} /></button></header>
    {error && <p className="db-error" role="alert">{error}</p>}
    {data && data.waiting.length > 0 && data.onlineRiders === 0 && <p className="db-error" role="alert">No riders are online. Call a rider and ask them to open the DOORSTEP rider app and tap “Go online” — the job then rings on their phone.{data.riders?.length ? ` Approved riders: ${data.riders.slice(0, 6).map((rider) => `${rider.name}${rider.phone ? ` (${rider.phone})` : ''}`).join(', ')}.` : ' No riders are approved yet — approve one in Riders first.'}</p>}
    {data && data.waiting.length === 0 && <p className="db-ok"><CheckCircle2 size={16} aria-hidden="true" />Every accepted order has a rider.</p>}
    {data?.waiting.length > 0 && <ul>{data.waiting.map((row) => {
      const late = row.waitingSince && Date.now() - new Date(row.waitingSince).getTime() > 10 * 60_000
      return <li key={row.deliveryId} className={late ? 'is-late' : ''}>
        <div><b>{row.orderNumber}</b><small>{row.business} · {row.orderStatus.replaceAll('_', ' ').toLowerCase()}</small><small>{row.address}</small></div>
        <div className="db-meta">
          <span>{late && <AlertTriangle size={14} aria-hidden="true" />}Waiting {row.waitingSince ? waited(row.waitingSince) : '—'}</span>
          <span><Bike size={14} aria-hidden="true" />{row.offerOpenUntil ? 'Offer open now' : `${row.offers} offered · ${row.declined} passed · ${row.expired} no answer`}</span>
          {!row.offerOpenUntil && <button type="button" onClick={() => retry(row.deliveryId)}><Send size={14} />Offer again</button>}
          {!row.offerOpenUntil && data.riders?.some((rider) => rider.online && !rider.busy) && <span className="db-send">
            <select value={pick[row.deliveryId] || ''} onChange={(event) => setPick({ ...pick, [row.deliveryId]: event.target.value })} aria-label="Send to rider">
              <option value="">Send to a rider…</option>
              {data.riders.filter((rider) => rider.online && !rider.busy).map((rider) => <option key={rider.id} value={rider.id}>{rider.name}{rider.network === 'BUSINESS_OWNED' ? ' (business rider)' : ''}</option>)}
            </select>
            <button type="button" onClick={() => sendTo(row.deliveryId)}><Bike size={14} />Send</button>
          </span>}
          {note[row.deliveryId] && <em>{note[row.deliveryId]}</em>}
        </div>
      </li>
    })}</ul>}
  </section>
}

/** Support confirms a handover when the customer can't give the delivery code. */
export function ConfirmDeliveredButton({ deliveryId, onDone }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  if (!open) return <button type="button" className="db-small" onClick={() => setOpen(true)}>Confirm delivered</button>
  return <form className="db-confirm" onSubmit={async (event) => { event.preventDefault(); setError(''); try { await call(`/api/admin/deliveries/${deliveryId}/confirm-delivered`, { method: 'POST', body: { note: text } }); setOpen(false); onDone?.() } catch (confirmError) { setError(confirmError.message) } }}>
    <input required minLength={5} maxLength={500} value={text} onChange={(event) => setText(event.target.value)} placeholder="How you confirmed it (e.g. called the customer)" />
    <button type="submit">Confirm</button><button type="button" onClick={() => setOpen(false)}>Cancel</button>
    {error && <small role="alert">{error}</small>}
  </form>
}

const BEFORE_PICKUP = ['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT']
const ON_THE_WAY = ['PICKED_UP', 'GOING_TO_CUSTOMER']
const nairaText = (minor) => `₦${(Math.round(minor || 0) / 100).toLocaleString('en-NG')}`

/**
 * Admin controls on a live delivery: before pickup, take the rider off (and optionally give the job to someone
 * else); after pickup, record a failed delivery with the refund and the rider's pay for the trip.
 */
export function DeliveryControls({ delivery, onDone }) {
  const [mode, setMode] = useState(null)
  const [riders, setRiders] = useState([])
  const [reasons, setReasons] = useState([])
  const [form, setForm] = useState({ reason: '', riderId: '', note: '', refund: '', riderPay: '' })
  const [state, setState] = useState({ busy: false, error: '', ok: '' })
  useEffect(() => {
    if (mode === 'reassign') call('/api/admin/dispatch').then((data) => setRiders((data.riders || []).filter((rider) => rider.online && !rider.busy))).catch(() => setRiders([]))
    if (mode === 'fail') {
      call('/api/admin/delivery-failure-reasons').then((data) => setReasons(data.reasons)).catch(() => setReasons([]))
      setForm((current) => ({ ...current, refund: String(Math.round((delivery.paidMinor || 0) / 100)), riderPay: delivery.plannedRiderPayMinor != null ? String(Math.round(delivery.plannedRiderPayMinor / 100)) : '' }))
    }
  }, [mode])
  const submit = async (event) => {
    event.preventDefault()
    setState({ busy: true, error: '', ok: '' })
    try {
      if (mode === 'reassign') {
        const result = await call(`/api/admin/deliveries/${delivery.id}/unassign`, { method: 'POST', body: { reason: form.reason, ...(form.riderId ? { riderId: form.riderId } : {}) } })
        setState({ busy: false, error: '', ok: result.message || (result.offered ? 'Done. The new rider has been offered the job.' : 'Done. The job is waiting for a rider again; automatic dispatch will offer it.') })
      } else {
        const body = { reason: form.reason, note: form.note, refundMinor: Math.round(Number(form.refund || 0) * 100), riderPayMinor: form.riderPay === '' ? null : Math.round(Number(form.riderPay) * 100) }
        if (!window.confirm(`Close ${delivery.orderNumber} as a failed delivery? Refund ${nairaText(body.refundMinor)} to the customer and pay the rider ${nairaText(body.riderPayMinor)}.`)) { setState({ busy: false, error: '', ok: '' }); return }
        await call(`/api/admin/deliveries/${delivery.id}/fail`, { method: 'POST', body })
        setState({ busy: false, error: '', ok: 'Recorded. The customer and rider were told; any refund is in Money › Refunds.' })
      }
      setMode(null); onDone?.()
    } catch (error) { setState({ busy: false, error: error.message, ok: '' }) }
  }
  const before = BEFORE_PICKUP.includes(delivery.status)
  const onTheWay = ON_THE_WAY.includes(delivery.status)
  if (!before && !onTheWay) return null
  if (!mode) return <span className="db-controls">
    {before && <button type="button" className="db-small" onClick={() => setMode('reassign')}>Take off / reassign</button>}
    {onTheWay && <button type="button" className="db-small is-danger" onClick={() => setMode('fail')}>Delivery failed</button>}
    {state.ok && <small className="db-ok" role="status">{state.ok}</small>}
  </span>
  return <form className="db-panel" onSubmit={submit}>
    {mode === 'reassign' ? <>
      <b>Take the rider off {delivery.orderNumber}</b>
      <label>Why<input required minLength={3} maxLength={300} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="e.g. Rider’s bike broke down" /></label>
      <label>Give it to<select value={form.riderId} onChange={(event) => setForm({ ...form, riderId: event.target.value })}><option value="">Nobody yet: automatic dispatch</option>{riders.map((rider) => <option key={rider.id} value={rider.id}>{rider.name}{rider.phone ? ` · ${rider.phone}` : ''}</option>)}</select></label>
    </> : <>
      <b>{delivery.orderNumber}: delivery failed</b>
      <label>Why<select required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })}><option value="">Choose…</option>{reasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.text}</option>)}</select></label>
      <label>What happened<input required minLength={5} maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="e.g. Called 3 times, no answer; rider waited 15 min" /></label>
      <label>Refund to the customer (₦, paid {nairaText(delivery.paidMinor)})<input inputMode="numeric" value={form.refund} onChange={(event) => setForm({ ...form, refund: event.target.value.replace(/[^\d]/g, '') })} /></label>
      <label>Pay the rider for the trip (₦)<input inputMode="numeric" value={form.riderPay} onChange={(event) => setForm({ ...form, riderPay: event.target.value.replace(/[^\d]/g, '') })} placeholder="0 for nothing" /></label>
      <small>The business keeps its share (it prepared the order). Nothing is deleted; it’s all in the activity log.</small>
    </>}
    <span className="db-panel-actions"><button type="submit" disabled={state.busy}>{state.busy ? 'Saving…' : 'Confirm'}</button><button type="button" onClick={() => setMode(null)}>Cancel</button></span>
    {state.error && <small role="alert" className="db-err">{state.error}</small>}
  </form>
}

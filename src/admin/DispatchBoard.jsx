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
  const retry = async (deliveryId) => {
    try { const result = await call(`/api/admin/deliveries/${deliveryId}/dispatch`, { method: 'POST' }); setNote({ [deliveryId]: result.offered ? 'Offered to the nearest free rider.' : result.message }); load() } catch (retryError) { setNote({ [deliveryId]: retryError.message }) }
  }
  return <section className="db" aria-labelledby="db-title">
    <header><div><h3 id="db-title">Waiting for a rider</h3><p>{data ? `${data.onlineRiders} rider${data.onlineRiders === 1 ? '' : 's'} online · ${data.freeRiders} free` : 'Loading…'}</p></div><button type="button" className="db-icon" onClick={load} aria-label="Refresh"><RefreshCw size={16} /></button></header>
    {error && <p className="db-error" role="alert">{error}</p>}
    {data && data.waiting.length === 0 && <p className="db-ok"><CheckCircle2 size={16} aria-hidden="true" />Every accepted order has a rider.</p>}
    {data?.waiting.length > 0 && <ul>{data.waiting.map((row) => {
      const late = row.waitingSince && Date.now() - new Date(row.waitingSince).getTime() > 10 * 60_000
      return <li key={row.deliveryId} className={late ? 'is-late' : ''}>
        <div><b>{row.orderNumber}</b><small>{row.business} · {row.orderStatus.replaceAll('_', ' ').toLowerCase()}</small><small>{row.address}</small></div>
        <div className="db-meta">
          <span>{late && <AlertTriangle size={14} aria-hidden="true" />}Waiting {row.waitingSince ? waited(row.waitingSince) : '—'}</span>
          <span><Bike size={14} aria-hidden="true" />{row.offerOpenUntil ? 'Offer open now' : `${row.offers} offered · ${row.declined} passed · ${row.expired} no answer`}</span>
          {!row.offerOpenUntil && <button type="button" onClick={() => retry(row.deliveryId)}><Send size={14} />Offer again</button>}
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

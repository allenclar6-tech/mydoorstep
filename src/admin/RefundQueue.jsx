import { useCallback, useEffect, useState } from 'react'
import { Mail, Phone, RotateCcw } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Admin › Money › Refunds to send: refunds that can't go back automatically (bank transfers, duplicate payments,
// failed Paystack refunds). Send the money from DOORSTEP's bank, then record it here — the customer is told.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const since = (value) => new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function RefundRow({ refund, onDone }) {
  const [open, setOpen] = useState(false)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const record = async () => {
    setBusy(true); setError('')
    try { await call(`/api/admin/refunds/${refund.paymentId}/record`, { method: 'POST', body: { bankReference: reference.trim() } }); onDone() } catch (recordError) { setError(recordError.message) } finally { setBusy(false) }
  }
  const customer = refund.customer
  return <li className="fa-owed">
    <span className="fa-owed-icon" aria-hidden="true"><RotateCcw size={16} /></span>
    <span className="fa-owed-main">
      <strong>{customer?.name || 'Customer'} · {refund.label}</strong>
      <small>{refund.why} · since {since(refund.neededAt)} · paid by {refund.method === 'BANK_TRANSFER' ? 'bank transfer' : 'card'} (ref {refund.reference})</small>
      {refund.paidFrom?.name && <small>Paid from: {refund.paidFrom.name}{refund.paidFrom.bank ? `, ${refund.paidFrom.bank}` : ''} (from their receipt)</small>}
      {customer && <span className="pp-contacts">
        {customer.phone && <a className="row-more" href={`tel:${customer.phone}`}><Phone size={13} /> {customer.phone}</a>}
        {customer.email && <a className="row-more" href={`mailto:${customer.email}`}><Mail size={13} /> Email</a>}
      </span>}
      {open && <span className="fa-manual"><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bank reference of your refund" aria-label="Bank reference of your refund" /><button type="button" className="admin-primary" disabled={busy || reference.trim().length < 3} onClick={record}>{busy ? 'Saving…' : 'Record'}</button></span>}
      {error && <small className="fa-error">{error}</small>}
    </span>
    <span className="fa-owed-amount"><b>{money(refund.amountMinor)}</b>
      {!open && <button type="button" className="row-more" onClick={() => setOpen(true)}>I’ve refunded it</button>}
    </span>
  </li>
}

export function RefundQueue({ onChanged }) {
  const [refunds, setRefunds] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => { call('/api/admin/refunds').then((data) => { setRefunds(data.refunds); setError('') }).catch((loadError) => setError(loadError.message)) }, [])
  useEffect(() => { load() }, [load])
  if (error) return <section className="fa-card"><h3>Refunds to send</h3><p className="fa-error">{error}</p></section>
  if (!refunds || refunds.length === 0) return null
  const total = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0)
  return <section className="fa-card">
    <h3><RotateCcw size={16} aria-hidden="true" /> Refunds to send ({refunds.length} · {money(total)})</h3>
    <p className="fa-muted">These can’t go back automatically. Ask the customer which account to use, send the money from DOORSTEP’s bank, then record it — the customer is told straight away.</p>
    <ul className="fa-list">{refunds.map((refund) => <RefundRow key={refund.paymentId} refund={refund} onDone={() => { load(); onChanged?.() }} />)}</ul>
  </section>
}

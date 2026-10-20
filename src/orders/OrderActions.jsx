import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CreditCard, Trash2, XCircle } from 'lucide-react'
import { apiBase } from '../config/apiBase'

export const ORDER_STATUS_LABELS = {
  PENDING_PAYMENT: 'Awaiting payment', PAID: 'Paid · waiting for the store', RESTAURANT_ACCEPTED: 'Accepted', PREPARING: 'Being prepared',
  READY_FOR_PICKUP: 'Ready for pickup', RIDER_ASSIGNED: 'Rider assigned', PICKED_UP: 'Picked up', OUT_FOR_DELIVERY: 'On the way',
  DELIVERED: 'Delivered', REJECTED: 'Declined', CANCELLED: 'Cancelled', REFUNDED: 'Refunded',
}
export const orderStatusTone = (status) => ['DELIVERED'].includes(status) ? 'done' : ['CANCELLED', 'REJECTED', 'REFUNDED'].includes(status) ? 'off' : status === 'PENDING_PAYMENT' ? 'warn' : 'live'

async function post(path, body) {
  const response = await fetch(`${apiBase}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'That didn’t work. Try again.')
  return data
}

/**
 * Starts (or restarts) payment for an unpaid order. The server checks the last attempt with Paystack first, so a
 * payment that actually went through is never taken twice. Returns { paid } or redirects to checkout.
 */
export async function startOrderPayment(orderId) {
  const body = await post('/api/payments/initialize', { orderId })
  if (body.paid) return { paid: true }
  if (body.method === 'BANK_TRANSFER') { window.location.assign(`/payment/bank-transfer/${orderId}`); return { redirected: true } }
  if (!body.authorizationUrl) throw new Error('Payment could not be started. Try again.')
  window.location.assign(body.authorizationUrl)
  return { redirected: true }
}

function PayNowButton({ order, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pay = async () => {
    setBusy(true); setError('')
    try { const result = await startOrderPayment(order.id); if (result.paid) onChanged?.('paid') } catch (payError) { setError(payError.message) } finally { setBusy(false) }
  }
  return <>
    <button type="button" className="oa-btn is-pay" disabled={busy} onClick={pay}><CreditCard size={15} aria-hidden="true" />{busy ? 'Opening…' : 'Pay now'}</button>
    {error && <p className="oa-error" role="alert">{error}</p>}
  </>
}

/** Bottom sheet asking the customer to confirm a cancel or remove. */
function ConfirmSheet({ mode, order, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  const paid = order.status === 'PAID'
  const unpaid = order.status === 'PENDING_PAYMENT'
  const amount = `₦${((order.totalMinor || 0) / 100).toLocaleString('en-NG')}`
  const confirm = async () => {
    setBusy(true); setError('')
    try {
      const result = mode === 'cancel' ? await post(`/api/orders/${order.id}/cancel`, { reason: reason || undefined }) : await post(`/api/orders/${order.id}/remove`)
      window.dispatchEvent(new Event('doorstep-notifications-change'))
      onDone(mode, result)
    } catch (actionError) { setError(actionError.message); setBusy(false) }
  }
  return createPortal(<>
    <div className="oa-backdrop" onClick={() => !busy && onClose()} aria-hidden="true" />
    <section className="oa-sheet" role="dialog" aria-modal="true" aria-labelledby="oa-title">
      <span className={`oa-icon${mode === 'remove' ? ' is-remove' : ''}`} aria-hidden="true">{mode === 'cancel' ? <XCircle size={26} /> : <Trash2 size={24} />}</span>
      <h2 id="oa-title">{mode === 'cancel' ? 'Cancel this order?' : unpaid ? 'Delete this order?' : 'Remove from your orders?'}</h2>
      <p>{mode === 'cancel'
        ? paid ? `${order.restaurant?.name || 'The store'} hasn’t accepted it yet. We’ll cancel it and refund ${amount} to your payment method.` : 'You haven’t paid, so nothing will be charged.'
        : unpaid ? 'It hasn’t been paid. We’ll cancel it and remove it from your list.' : 'It disappears from your list. We keep a copy of the receipt for payment and tax records.'}</p>
      {mode === 'cancel' && <div className="oa-reasons" role="radiogroup" aria-label="Reason (optional)">
        {['Ordered by mistake', 'Changed my mind', 'Taking too long', 'Wrong address'].map((option) => <button type="button" key={option} role="radio" aria-checked={reason === option} className={reason === option ? 'is-active' : ''} onClick={() => setReason(reason === option ? '' : option)}>{option}</button>)}
      </div>}
      {error && <p className="oa-error" role="alert">{error}</p>}
      <div className="oa-buttons">
        <button type="button" className="oa-danger" disabled={busy} onClick={confirm}>{busy ? 'Working…' : mode === 'cancel' ? 'Yes, cancel order' : unpaid ? 'Yes, delete it' : 'Remove'}</button>
        <button type="button" className="oa-keep" disabled={busy} onClick={onClose}>{mode === 'cancel' ? 'Keep my order' : 'Keep it'}</button>
      </div>
    </section>
  </>, document.body)
}

/** Cancel / delete buttons for one order. `actions` comes from the API (what the server allows right now). */
export function OrderActionButtons({ order, onChanged, compact = false }) {
  const [mode, setMode] = useState(null)
  const actions = order.actions || {}
  if (!actions.canCancel && !actions.canRemove && !actions.canPay) return null
  const unpaid = order.status === 'PENDING_PAYMENT'
  return <div className={`oa-row${compact ? ' is-compact' : ''}`} onClick={(event) => event.stopPropagation()}>
    {actions.canPay && <PayNowButton order={order} onChanged={onChanged} />}
    {actions.canCancel && <button type="button" className="oa-btn" onClick={() => setMode('cancel')}><XCircle size={15} aria-hidden="true" />Cancel order</button>}
    {actions.canRemove && <button type="button" className="oa-btn is-quiet" onClick={() => setMode('remove')}><Trash2 size={15} aria-hidden="true" />{unpaid ? 'Delete' : 'Remove'}</button>}
    {mode && <ConfirmSheet mode={mode} order={order} onClose={() => setMode(null)} onDone={(done, result) => { setMode(null); onChanged?.(done, result) }} />}
  </div>
}

import { lazy, Suspense, useEffect, useState } from 'react'
import { Bike, Check, ChefHat, ChevronRight, Clock3, HelpCircle, MapPin, Phone, ReceiptText, RefreshCw, ShoppingBag, Star, Store } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { LiveOrderCard } from '../live/LiveOrderCard'
import { OrderActionButtons, ORDER_STATUS_LABELS } from '../orders/OrderActions'
import { useDeliveryTracking } from '../tracking/useDeliveryTracking'
import { Band, EmptyState, ShopHeader, SkeletonList, TabBar } from './ShopKit'
import { ACTIVE_ORDER_STATUSES, authHeaders, naira, navigate, token } from './shopData'

// Orders tab (Glovo-style): "In progress" orders on top with a progress bar, then past orders. Tapping one opens
// its tracking screen: status, steps, live map and rider (when the delivery has them), and the receipt.
// Everything comes from the real order and tracking APIs; nothing here is simulated.

const DeliveryTrackingMap = lazy(() => import('../DeliveryTrackingMap').then((module) => ({ default: module.DeliveryTrackingMap })))

const DELIVERY_STEPS = [
  { key: 'placed', label: 'Order placed', statuses: ['PAID'] },
  { key: 'accepted', label: 'Accepted', statuses: ['RESTAURANT_ACCEPTED'] },
  { key: 'preparing', label: 'Being prepared', statuses: ['PREPARING', 'READY_FOR_PICKUP'] },
  { key: 'onway', label: 'On the way', statuses: ['RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] },
  { key: 'delivered', label: 'Delivered', statuses: ['DELIVERED'] },
]
const PICKUP_STEPS = [
  { key: 'placed', label: 'Order placed', statuses: ['PAID'] },
  { key: 'accepted', label: 'Accepted', statuses: ['RESTAURANT_ACCEPTED'] },
  { key: 'preparing', label: 'Being prepared', statuses: ['PREPARING'] },
  { key: 'ready', label: 'Ready to collect', statuses: ['READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] },
  { key: 'collected', label: 'Collected', statuses: ['DELIVERED'] },
]
const stepsFor = (order) => (order?.orderType === 'PICKUP' ? PICKUP_STEPS : DELIVERY_STEPS)
/** Index of the current step, or -1 for orders outside the normal flow (unpaid, cancelled, rejected, refunded). */
export const stepIndex = (order) => stepsFor(order).findIndex((step) => step.statuses.includes(order?.status))

const HEADLINE = {
  PENDING_PAYMENT: 'Waiting for your payment',
  PAID: 'Waiting for the store to accept',
  RESTAURANT_ACCEPTED: 'The store accepted your order',
  PREPARING: 'Your order is being prepared',
  READY_FOR_PICKUP: 'Your order is ready',
  RIDER_ASSIGNED: 'A rider is on the way to the store',
  PICKED_UP: 'Your rider has your order',
  OUT_FOR_DELIVERY: 'Your order is on its way',
  DELIVERED: 'Delivered. Enjoy!',
  REJECTED: 'The store couldn’t take this order',
  CANCELLED: 'This order was cancelled',
  REFUNDED: 'This order was refunded',
}
const headlineFor = (order) => order.orderType === 'PICKUP' && order.status === 'READY_FOR_PICKUP' ? 'Ready to collect' : order.orderType === 'PICKUP' && order.status === 'DELIVERED' ? 'Collected. Enjoy!' : HEADLINE[order.status] || ORDER_STATUS_LABELS[order.status] || order.status
const tone = (status) => ACTIVE_ORDER_STATUSES.includes(status) ? 'live' : status === 'DELIVERED' ? 'done' : status === 'PENDING_PAYMENT' ? 'wait' : 'stop'
const when = (iso) => {
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay ? `Today, ${date.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}` : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const itemCount = (order) => (order.items || []).reduce((sum, item) => sum + item.quantity, 0)

const problemText = (error) => error instanceof TypeError ? 'We can’t reach DOORSTEP. Check your internet and try again.' : 'Your orders couldn’t load right now. Please try again.'

function useOrders() {
  const [state, setState] = useState({ loading: true, orders: [], error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!token()) { setState({ loading: false, orders: [], error: '' }); return undefined }
    let active = true
    const load = (quiet) => {
      if (!quiet) setState((current) => ({ ...current, loading: !current.orders.length, error: '' }))
      fetch(`${apiBase}/api/orders?limit=50`, { headers: authHeaders() }).then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(body.orders)) throw new Error('ORDERS_UNAVAILABLE')
        if (active) setState({ loading: false, orders: body.orders, error: '' })
      }).catch((error) => { if (active) setState((current) => ({ ...current, loading: false, error: current.orders.length ? '' : problemText(error) })) })
    }
    load(false)
    const timer = window.setInterval(() => { if (!document.hidden) load(true) }, 20_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [attempt])
  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

function Progress({ order }) {
  const steps = stepsFor(order)
  const at = stepIndex(order)
  if (at < 0) return null
  return <div className="or-progress" aria-hidden="true">{steps.map((step, index) => <i key={step.key} className={index <= at ? 'is-on' : ''} />)}</div>
}

function OrderCard({ order }) {
  const live = ACTIVE_ORDER_STATUSES.includes(order.status)
  const open = () => navigate(`/account/orders/${order.id}`)
  return <li>
    <button type="button" className={`or-card${live ? ' is-live' : ''}`} onClick={open}>
      <span className="or-store" aria-hidden="true">{order.orderType === 'PICKUP' ? <ShoppingBag size={20} /> : <Store size={20} />}</span>
      <span className="or-main">
        <b>{order.restaurant?.name || 'Your order'}</b>
        <small>{when(order.createdAt)} · {itemCount(order)} item{itemCount(order) === 1 ? '' : 's'} · {naira(order.totalMinor)}</small>
        <span className={`or-status is-${tone(order.status)}`}>{live && <i className="or-pulse" aria-hidden="true" />}{headlineFor(order)}</span>
        {live && <Progress order={order} />}
      </span>
      <ChevronRight size={18} aria-hidden="true" className="or-chev" />
    </button>
    {order.actions && (order.actions.canPay || order.actions.canCancel) && <div className="or-card-actions"><OrderActionButtons order={order} compact onChanged={() => window.dispatchEvent(new Event('doorstep-orders-changed'))} /></div>}
  </li>
}

/** /account/orders — the Orders tab. */
export function OrdersPage() {
  const { loading, orders, error, retry } = useOrders()
  useEffect(() => { const again = () => retry(); window.addEventListener('doorstep-orders-changed', again); return () => window.removeEventListener('doorstep-orders-changed', again) }, [retry])
  const active = orders.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status) || order.status === 'PENDING_PAYMENT')
  const past = orders.filter((order) => !active.includes(order))
  let body
  if (!token()) body = <EmptyState icon={ReceiptText} title="Sign in to see your orders" body="Your orders, receipts and live tracking are saved to your DOORSTEP account." action={<button type="button" className="sp-primary" onClick={() => navigate('/login?return=/account/orders')}>Sign in</button>} />
  else if (loading) body = <SkeletonList rows={3} />
  else if (error) body = <EmptyState icon={RefreshCw} title="Couldn’t load your orders" body={error} action={<button type="button" className="sp-primary" onClick={retry}>Try again</button>} />
  else if (!orders.length) body = <EmptyState icon={ShoppingBag} title="No orders yet" body="When you order, you’ll follow it here from the kitchen to your door." action={<button type="button" className="sp-primary" onClick={() => navigate('/')}>Start an order</button>} />
  else body = <>
    {active.length > 0 && <section className="or-section" aria-labelledby="or-active"><h2 id="or-active">In progress</h2><ul className="or-list">{active.map((order) => <OrderCard key={order.id} order={order} />)}</ul></section>}
    {past.length > 0 && <section className="or-section" aria-labelledby="or-past"><h2 id="or-past">Past orders</h2><ul className="or-list">{past.map((order) => <OrderCard key={order.id} order={order} />)}</ul></section>}
  </>
  return <div className="sp-screen or-page">
    <Band title="Orders" />
    <main className="sp-body or-body">{body}</main>
    <TabBar active="orders" />
  </div>
}

/* ------------------------------ tracking screen ------------------------------ */
function useTracking(orderId) {
  const [state, setState] = useState({ loading: true, order: null, error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!token()) { setState({ loading: false, order: null, error: 'Sign in to see this order.' }); return undefined }
    let active = true
    let timer
    const load = async () => {
      if (document.hidden) return
      try {
        const response = await fetch(`${apiBase}/api/orders/${encodeURIComponent(orderId)}/tracking`, { headers: authHeaders() })
        const body = await response.json().catch(() => ({}))
        if (response.status === 404 || response.status === 403) throw Object.assign(new Error('This order isn’t on your account.'), { final: true })
        if (!response.ok || !body.order) throw new Error('Couldn’t refresh this order.')
        if (active) setState({ loading: false, order: body.order, error: '' })
      } catch (error) {
        if (active) setState((current) => ({ ...current, loading: false, error: error.final ? error.message : current.order ? 'Showing the last update — reconnecting…' : problemText(error) }))
      }
    }
    load()
    timer = window.setInterval(load, 15_000)
    const onShow = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onShow)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onShow) }
  }, [orderId, attempt])
  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

/** The receipt (items and totals) comes from the order list, which has the full breakdown. */
function useReceipt(orderId) {
  const [receipt, setReceipt] = useState(null)
  useEffect(() => {
    if (!token()) return undefined
    let active = true
    fetch(`${apiBase}/api/orders?limit=50`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => {
      if (active) setReceipt(body?.orders?.find((order) => order.id === orderId) || null)
    }).catch(() => undefined)
    return () => { active = false }
  }, [orderId])
  return receipt
}

function Steps({ order }) {
  const steps = stepsFor(order)
  const at = stepIndex(order)
  const Icons = [ReceiptText, Check, ChefHat, order.orderType === 'PICKUP' ? ShoppingBag : Bike, Check]
  return <ol className="or-steps">{steps.map((step, index) => {
    const Icon = Icons[index]
    const state = index < at ? 'is-done' : index === at ? 'is-now' : ''
    return <li key={step.key} className={state}><span className="or-step-dot" aria-hidden="true">{index < at ? <Check size={14} /> : <Icon size={14} />}</span><span>{step.label}</span>{index === at && <span className="or-sr">(current step)</span>}</li>
  })}</ol>
}

function Rating({ orderId, storeName }) {
  const [stars, setStars] = useState(0)
  const [text, setText] = useState('')
  const [state, setState] = useState({ busy: false, done: false, message: '' })
  const send = async (event) => {
    event.preventDefault()
    if (!stars) { setState({ busy: false, done: false, message: 'Tap the stars to rate your order.' }); return }
    setState({ busy: true, done: false, message: '' })
    try {
      const response = await fetch(`${apiBase}/api/reviews`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ orderId, rating: stars, body: text.trim() || undefined }) })
      const body = await response.json().catch(() => ({}))
      if (response.ok) setState({ busy: false, done: true, message: 'Thank you! Your review helps other customers choose.' })
      else setState({ busy: false, done: body.error === 'ORDER_ALREADY_REVIEWED', message: body.error === 'ORDER_ALREADY_REVIEWED' ? 'You’ve already reviewed this order. Thank you!' : 'Your review couldn’t be saved. Please try again.' })
    } catch { setState({ busy: false, done: false, message: 'We can’t reach DOORSTEP. Check your internet.' }) }
  }
  if (state.done) return <section className="or-card-box or-rate is-done"><Star size={20} aria-hidden="true" /><p>{state.message}</p></section>
  return <form className="or-card-box or-rate" onSubmit={send}>
    <h3>How was {storeName || 'your order'}?</h3>
    <div className="or-stars" role="radiogroup" aria-label="Your rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={stars === value} aria-label={`${value} star${value === 1 ? '' : 's'}`} className={value <= stars ? 'is-on' : ''} onClick={() => setStars(value)}><Star size={30} /></button>)}</div>
    <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} rows={3} placeholder="Tell other customers what you liked (optional)" />
    {state.message && <p className="or-note">{state.message}</p>}
    <button type="submit" className="sp-primary" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send review'}</button>
  </form>
}

/** /account/orders/:id — live tracking and receipt. */
export function OrderTrackPage({ orderId }) {
  const { loading, order, error, retry } = useTracking(orderId)
  const receipt = useReceipt(orderId)
  const tracking = useDeliveryTracking(order?.delivery?.id)
  const header = <ShopHeader title={order?.orderNumber || receipt?.orderNumber || 'Your order'} back="/account/orders" />
  if (!order) return <div className="sp-screen or-page">{header}<main className="sp-body">{loading ? <SkeletonList rows={3} /> : <EmptyState icon={ReceiptText} title="Order not available" body={error || 'This order couldn’t be found.'} action={<div className="or-empty-actions"><button type="button" className="sp-primary" onClick={retry}>Try again</button><button type="button" className="sp-ghost" onClick={() => navigate('/account/orders')}>All orders</button></div>} />}</main></div>
  const live = ACTIVE_ORDER_STATUSES.includes(order.status)
  const rider = order.delivery?.rider
  const pickup = order.orderType === 'PICKUP'
  const items = receipt?.items || []
  return <div className="sp-screen or-page or-track">
    {header}
    <main className="sp-body or-body">
      <section className={`or-hero is-${tone(order.status)}`} aria-live="polite">
        <small>{order.restaurant}</small>
        <h2>{headlineFor(order)}</h2>
        {order.scheduledFor && <p><Clock3 size={15} aria-hidden="true" />Scheduled for {new Date(order.scheduledFor).toLocaleString('en-NG', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>}
        {pickup && order.pickupAddress && <p><MapPin size={15} aria-hidden="true" />Collect from {order.pickupAddress}</p>}
        {stepIndex(order) >= 0 && <Steps order={order} />}
      </section>
      {error && <p className="or-note is-warn" role="status">{error}</p>}

      {live && !pickup && <LiveOrderCard order={order} />}
      {tracking.snapshot && <section className="or-map" aria-label="Live delivery map"><Suspense fallback={<div className="sp-skeleton or-map-skeleton" role="status" aria-label="Loading the map" />}><DeliveryTrackingMap tracking={tracking.snapshot} connection={tracking.connection} /></Suspense></section>}

      {/* The live card already shows the rider with a call button; this one is for when it isn't shown. */}
      {rider && !(live && !pickup && order.live) && <section className="or-card-box or-rider">
        <span className="or-rider-avatar" aria-hidden="true"><Bike size={20} /></span>
        <span><b>{rider.name}</b><small>Your DOORSTEP rider</small></span>
        {rider.callAllowed && rider.phone && <a className="or-call" href={`tel:${rider.phone}`} aria-label={`Call ${rider.name}`}><Phone size={18} /></a>}
      </section>}

      {order.actions && <OrderActionButtons order={{ ...order, restaurant: { name: order.restaurant } }} onChanged={(done) => done === 'remove' ? navigate('/account/orders') : retry()} />}

      {order.status === 'DELIVERED' && <Rating orderId={order.id} storeName={order.restaurant} />}

      <section className="or-card-box or-receipt" aria-labelledby="or-receipt">
        <h3 id="or-receipt">Your order</h3>
        {items.length ? <ul>{items.map((item) => <li key={item.id}><span className="or-qty">{item.quantity}×</span><span>{item.nameSnapshot}{Array.isArray(item.optionsSnapshot) && item.optionsSnapshot.length > 0 && <small>{item.optionsSnapshot.map((option) => option.name).join(', ')}</small>}{item.instructions && <small>{item.instructions}</small>}</span><b>{naira(item.unitPriceMinor * item.quantity)}</b></li>)}</ul> : <p className="or-note">{receipt === null ? 'Loading items…' : ''}</p>}
        {receipt && <dl>
          <div><dt>Items</dt><dd>{naira(receipt.subtotalMinor)}</dd></div>
          {!pickup && <div><dt>Delivery</dt><dd>{receipt.deliveryFeeMinor ? naira(receipt.deliveryFeeMinor) : 'Free'}</dd></div>}
          <div><dt>Service fee</dt><dd>{naira(receipt.serviceFeeMinor)}</dd></div>
          {receipt.tipMinor > 0 && <div><dt>Rider tip</dt><dd>{naira(receipt.tipMinor)}</dd></div>}
          {receipt.discountMinor > 0 && <div className="is-saving"><dt>Discount{receipt.promoCode ? ` (${receipt.promoCode})` : ''}</dt><dd>−{naira(receipt.discountMinor)}</dd></div>}
          <div className="is-total"><dt>Total</dt><dd>{naira(receipt.totalMinor)}</dd></div>
        </dl>}
        {receipt?.payment?.status && <p className="or-note">Payment: {receipt.payment.status === 'SUCCESSFUL' ? 'paid' : receipt.payment.status.toLowerCase().replaceAll('_', ' ')}</p>}
        {!pickup && receipt?.addressSnapshot && <p className="or-address"><MapPin size={15} aria-hidden="true" />{receipt.addressSnapshot}</p>}
      </section>

      <button type="button" className="or-help" onClick={() => navigate('/account/support')}><HelpCircle size={19} aria-hidden="true" /><span><b>Need help with this order?</b><small>Chat with DOORSTEP support</small></span><ChevronRight size={18} aria-hidden="true" /></button>
    </main>
  </div>
}

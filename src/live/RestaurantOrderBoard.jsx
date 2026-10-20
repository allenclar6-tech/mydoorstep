import { useCallback, useEffect, useRef, useState } from 'react'
import { Bike, Check, ChefHat, Clock3, PackageCheck, Phone, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { formatNaira } from '../data'

const authHeaders = () => { let token = null; try { token = localStorage.getItem('doorstep-token') } catch { token = null } return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
const TABS = [
  ['new', 'New', (order) => order.status === 'PAID'],
  ['kitchen', 'In the kitchen', (order) => ['RESTAURANT_ACCEPTED', 'PREPARING'].includes(order.status)],
  ['ready', 'Ready', (order) => ['READY_FOR_PICKUP', 'RIDER_ASSIGNED'].includes(order.status)],
  ['out', 'On the way', (order) => ['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(order.status)],
  ['done', 'Done', (order) => ['DELIVERED', 'CANCELLED', 'REJECTED', 'REFUNDED'].includes(order.status)],
]
const DECLINE_REASONS = ['An item is sold out', 'We’re closing soon', 'Too busy right now', 'Can’t make this order']
const minutesSince = (value) => value ? Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000)) : null

function riderLine(order) {
  const delivery = order.delivery
  if (!delivery || ['PAID', 'DELIVERED', 'CANCELLED', 'REJECTED', 'REFUNDED'].includes(order.status)) return null
  if (!delivery.riderId) return { tone: 'wait', text: delivery.status === 'REQUESTED' ? 'Offering to the nearest rider…' : 'Finding a rider…' }
  const name = delivery.rider?.user?.firstName || 'Your rider'
  const text = { ACCEPTED: `${name} accepted and is getting ready`, GOING_TO_RESTAURANT: `${name} is on the way to you`, ARRIVED_AT_RESTAURANT: `${name} is at your counter`, PICKED_UP: `${name} has the order`, GOING_TO_CUSTOMER: `${name} is delivering it` }[delivery.status] || `${name} assigned`
  return { tone: delivery.status === 'ARRIVED_AT_RESTAURANT' ? 'here' : 'ok', text, phone: delivery.rider?.user?.phone }
}

function OrderCard({ order, onChanged }) {
  const [busy, setBusy] = useState('')
  const [declining, setDeclining] = useState(false)
  const [error, setError] = useState('')
  const customer = `${order.customer?.firstName || 'Customer'} ${order.customer?.lastName || ''}`.trim()
  const items = order.items || []
  const rider = riderLine(order)
  const age = minutesSince(order.paidAt || order.createdAt)
  const act = async (label, path, body) => {
    setBusy(label); setError('')
    try {
      const response = await fetch(`${apiBase}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'That didn’t work. Refresh and try again.')
      setDeclining(false); onChanged()
    } catch (actError) { setError(actError.message) } finally { setBusy('') }
  }
  const status = (next) => act(next, `/api/orders/${order.id}/status`, { status: next })
  return <article className={`rb-card is-${order.status.toLowerCase()}`}>
    <header>
      <div><b>{order.orderNumber}</b><small>{customer}{age != null ? ` · ${age} min ago` : ''}</small></div>
      <strong>{formatNaira((order.subtotalMinor ?? order.totalMinor ?? 0) / 100)}</strong>
    </header>
    <ul className="rb-items">{items.map((item) => <li key={item.id}><b>{item.quantity}×</b> {item.nameSnapshot}{item.instructions && <em> — {item.instructions}</em>}</li>)}</ul>
    {order.landmarkSnapshot && <p className="rb-note">Landmark: {order.landmarkSnapshot}</p>}
    {rider && <p className={`rb-rider is-${rider.tone}`}><Bike size={15} aria-hidden="true" />{rider.text}{rider.phone && <a href={`tel:${rider.phone}`} aria-label="Call rider"><Phone size={14} /></a>}</p>}
    {error && <p className="rb-error" role="alert">{error}</p>}
    {order.status === 'PAID' && !declining && <div className="rb-actions">
      <button type="button" className="rb-ghost" disabled={Boolean(busy)} onClick={() => setDeclining(true)}><X size={16} />Decline</button>
      <button type="button" className="rb-primary" disabled={Boolean(busy)} onClick={() => status('RESTAURANT_ACCEPTED')}><Check size={16} />{busy ? 'Accepting…' : 'Accept order'}</button>
    </div>}
    {order.status === 'PAID' && declining && <div className="rb-decline">
      <p>Why can’t you take it? The customer is refunded straight away.</p>
      <div className="rb-chips">{DECLINE_REASONS.map((reason) => <button type="button" key={reason} disabled={Boolean(busy)} onClick={() => act('decline', `/api/restaurant/orders/${order.id}/decline`, { reason })}>{reason}</button>)}</div>
      <button type="button" className="rb-link" onClick={() => setDeclining(false)}>Keep the order</button>
    </div>}
    {order.status === 'RESTAURANT_ACCEPTED' && <div className="rb-actions"><button type="button" className="rb-primary" disabled={Boolean(busy)} onClick={() => status('PREPARING')}><ChefHat size={16} />Start preparing</button></div>}
    {order.status === 'PREPARING' && <div className="rb-actions"><button type="button" className="rb-primary" disabled={Boolean(busy)} onClick={() => status('READY_FOR_PICKUP')}><PackageCheck size={16} />Ready for pickup</button></div>}
    {['READY_FOR_PICKUP', 'RIDER_ASSIGNED'].includes(order.status) && <p className="rb-hint"><Clock3 size={14} aria-hidden="true" />Packed and waiting. Hand it over when the rider arrives.</p>}
    {order.status === 'REJECTED' && <p className="rb-hint">Declined{order.cancellationReason ? ` — ${order.cancellationReason.replace(/^Declined by [^:]+: /, '')}` : ''}</p>}
  </article>
}

/** Live order board for businesses: accept or decline, cook, mark ready — with the rider's progress shown. */
export function RestaurantOrderBoard() {
  const [orders, setOrders] = useState(null)
  const [tab, setTab] = useState('new')
  const [error, setError] = useState('')
  const lastNew = useRef(null)
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/restaurant/orders?limit=100`, { headers: authHeaders() })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Could not load your orders.')
      const list = (body.orders || []).filter((order) => order.status !== 'PENDING_PAYMENT')
      const newest = list.filter((order) => order.status === 'PAID').map((order) => order.id).join(',')
      if (lastNew.current !== null && newest && newest !== lastNew.current) { try { navigator.vibrate?.([300, 150, 300]) } catch { /* not supported */ } }
      lastNew.current = newest
      setOrders(list); setError('')
    } catch (loadError) { setError(loadError instanceof TypeError ? 'No connection. Retrying…' : loadError.message) }
  }, [])
  useEffect(() => {
    load()
    const timer = window.setInterval(() => { if (!document.hidden) load() }, 12_000)
    document.addEventListener('visibilitychange', load)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', load) }
  }, [load])
  const counts = Object.fromEntries(TABS.map(([key, , match]) => [key, (orders || []).filter(match).length]))
  const shown = (orders || []).filter(TABS.find(([key]) => key === tab)[2])
  return <section className="rb">
    <div className="rb-head"><div><span className="rb-kicker">LIVE ORDERS</span><h2>{counts.new ? `${counts.new} new order${counts.new > 1 ? 's' : ''} waiting` : 'You’re all caught up'}</h2><p>Accept quickly — DOORSTEP sends the nearest rider as soon as you accept.</p></div></div>
    <nav className="rb-tabs" aria-label="Order stages">{TABS.map(([key, label]) => <button type="button" key={key} className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}>{label}{counts[key] > 0 && <b>{counts[key]}</b>}</button>)}</nav>
    {error && <p className="rb-error" role="alert">{error}</p>}
    {!orders && !error && <p className="rb-empty">Loading orders…</p>}
    {orders && shown.length === 0 && <p className="rb-empty">{tab === 'new' ? 'No new orders right now. This page refreshes by itself.' : 'Nothing here.'}</p>}
    <div className="rb-list">{shown.map((order) => <OrderCard key={order.id} order={order} onChanged={load} />)}</div>
  </section>
}

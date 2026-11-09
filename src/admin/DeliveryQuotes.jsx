import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Bike, Check, ChevronRight, Clock3, MapPin, Phone, RefreshCw, Search, Store, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Admin › Prices to confirm: orders whose delivery fee a person must set (the map couldn't place the address, the
// road distance wasn't reliable, the trip is unusually long, or the fee was above the automatic limit).
// The price is fixed between DOORSTEP and its riders (Ask riders → their prices → you choose the rider pay), then
// sent to the customer, who can only accept (and pay) or decline. Every step is kept in the history.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.message || 'Something went wrong. Try again.'), { status: response.status })
  return data
}
const naira = (minor) => minor == null ? '—' : `₦${(Math.round(minor) / 100).toLocaleString('en-NG')}`
const when = (iso) => iso ? new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

const STATUS = {
  PENDING_REVIEW: ['Needs a price', 'is-todo'],
  CUSTOMER_REVIEW_REQUESTED: ['Customer asked for review', 'is-todo'],
  QUOTE_EXPIRED: ['Expired — send again', 'is-todo'],
  QUOTE_SENT: ['Waiting for customer', 'is-wait'],
  QUOTE_REVISED: ['Revised — waiting', 'is-wait'],
  QUOTE_ACCEPTED: ['Accepted', 'is-ok'],
  QUOTE_DECLINED: ['Declined', 'is-off'],
  QUOTE_CANCELLED: ['Cancelled', 'is-off'],
}
const REASONS = { LOCATION_NOT_MAPPED: 'Address not on the map', DISTANCE_NOT_RELIABLE: 'Distance not reliable', BEYOND_NORMAL_DISTANCE: 'Further than usual', FEE_ABOVE_AUTO_LIMIT: 'Fee above auto limit' }
const EVENT_TEXT = { RIDERS_ASKED: 'Riders asked for their price', RIDER_PRICE: 'Rider answered', REQUESTED: 'Order sent for a delivery price', QUOTE_SENT: 'Price sent', QUOTE_REVISED: 'Revised price sent', CUSTOMER_ACCEPTED: 'Customer accepted', CUSTOMER_DECLINED: 'Customer declined', CUSTOMER_REVIEW_REQUESTED: 'Customer asked for a review', REVIEW_DECLINED: 'Kept the price', DISTANCE_CORRECTED: 'Distance corrected', EXPIRED: 'Price expired', CANCELLED: 'Request cancelled', PICKUP_CHANGED: 'Store moved its pickup point' }
const Pill = ({ status }) => { const [label, tone] = STATUS[status] || [status, '']; return <span className={`dq-pill ${tone}`}>{label}</span> }
const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
const routeLink = (from, to) => `https://www.google.com/maps/dir/?api=1&origin=${from.latitude},${from.longitude}&destination=${to.latitude},${to.longitude}&travelmode=driving`

function Overview() {
  const [data, setData] = useState(null)
  useEffect(() => { call('/api/admin/delivery-quotes-summary?days=30').then(setData).catch(() => setData(null)) }, [])
  if (!data) return null
  const tiles = [
    ['Delivery orders (30 days)', data.deliveryOrders],
    ['Priced automatically', data.automatic],
    ['Sent for a manual price', data.manual],
    ['Waiting for you', data.pendingReview],
    ['Waiting for customers', data.awaitingCustomer],
    ['Acceptance rate', data.acceptanceRate == null ? '—' : `${data.acceptanceRate}%`],
    ['Average delivery fee', naira(data.averageFeeMinor)],
    ['Delivery fees collected', naira(data.deliveryRevenueMinor)],
    ['Distance corrections', data.corrections],
  ]
  return <section className="dq-overview" aria-label="Last 30 days">{tiles.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</section>
}

function Detail({ id, onBack, onChanged }) {
  const [quote, setQuote] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ fee: '', riderPay: '', riderId: '', explanation: '', internalNote: '', hours: '24', method: 'MANUAL_QUOTE', correctKm: '', correctReason: '' })
  const [riderPrices, setRiderPrices] = useState(null)
  const [ask, setAsk] = useState({ pay: '', note: '' })
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState({ tone: '', text: '' })
  const load = useCallback(() => call(`/api/admin/delivery-quotes/${id}`).then((body) => { setQuote(body.quote); setError('') }).catch((loadError) => setError(loadError.message)), [id])
  const loadRiderPrices = useCallback(() => { call(`/api/admin/delivery-quotes/${id}/rider-prices`).then((data) => setRiderPrices(data.prices)).catch(() => setRiderPrices([])) }, [id])
  useEffect(() => { loadRiderPrices() }, [loadRiderPrices])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (quote && form.fee === '') { const last = quote.versions.at(-1); const start = last?.feeMinor ?? quote.estimateFeeMinor; if (start != null) setForm((current) => ({ ...current, fee: String(Math.round(start / 100)), ...(last?.riderPayMinor != null ? { riderPay: String(Math.round(last.riderPayMinor / 100)) } : {}) })) } }, [quote])
  if (error) return <div className="dq-detail"><button type="button" className="dq-back" onClick={onBack}><ArrowLeft size={16} />All requests</button><p className="dq-msg is-error">{error}</p></div>
  if (!quote) return <div className="dq-detail"><p className="dq-muted">Loading…</p></div>
  const order = quote.order
  const open = ['PENDING_REVIEW', 'QUOTE_SENT', 'CUSTOMER_REVIEW_REQUESTED', 'QUOTE_REVISED', 'QUOTE_EXPIRED'].includes(quote.status)
  const pickup = order.restaurant.latitude != null ? { latitude: Number(order.restaurant.latitude), longitude: Number(order.restaurant.longitude) } : null
  const drop = order.latitude != null ? { latitude: Number(order.latitude), longitude: Number(order.longitude) } : null
  const original = quote.originalDistance || {}
  const latestReview = [...quote.versions].reverse().find((version) => version.customerResponse === 'REVIEW')
  const act = async (kind, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(kind); setResult({ tone: '', text: '' })
    try {
      await call(`/api/admin/delivery-quotes/${id}/${kind}`, { method: 'POST', body })
      setResult({ tone: 'ok', text: kind === 'offer' ? 'Sent. The customer has been notified.' : kind === 'ask-riders' ? 'Riders asked. Their prices will appear here as they answer.' : kind === 'keep' ? 'The customer was told the price stays the same.' : 'Request cancelled and the customer told.' })
      await load(); loadRiderPrices(); onChanged()
    } catch (actError) { setResult({ tone: 'error', text: actError.message }) } finally { setBusy('') }
  }
  const send = () => {
    const feeMinor = form.method === 'FREE_DELIVERY' ? 0 : Math.round(Number(form.fee) * 100)
    if (form.method !== 'FREE_DELIVERY' && (!Number.isFinite(feeMinor) || feeMinor < 0 || form.fee === '')) { setResult({ tone: 'error', text: 'Type the delivery fee in naira, e.g. 1500.' }); return }
    if (form.correctKm && !form.correctReason.trim()) { setResult({ tone: 'error', text: 'Say why you corrected the distance.' }); return }
    const riderPayMinor = form.riderPay === '' ? null : Math.round(Number(form.riderPay) * 100)
    if (riderPayMinor == null) { setResult({ tone: 'error', text: 'Type the rider’s pay for this trip (agree it with riders first if you’re unsure).' }); return }
    const body = { feeMinor, pricingMethod: form.method, riderPayMinor, ...(form.riderId ? { agreedRiderId: form.riderId } : {}), expiresInHours: Number(form.hours) || 24, ...(form.explanation.trim() ? { explanation: form.explanation.trim() } : {}), ...(form.internalNote.trim() ? { internalNote: form.internalNote.trim() } : {}), ...(form.correctKm ? { correctedDistanceKm: Number(form.correctKm), correctionReason: form.correctReason.trim() } : {}) }
    act('offer', body, `${quote.currentVersion ? 'Send this revised price' : 'Send this price'} (${form.method === 'FREE_DELIVERY' ? 'free delivery' : naira(feeMinor)}) to the customer? The rider is paid ${naira(riderPayMinor)}.`)
  }
  return <div className="dq-detail">
    <button type="button" className="dq-back" onClick={onBack}><ArrowLeft size={16} />All requests</button>
    <header className="dq-head"><div><h2>{order.orderNumber}</h2><small>Placed {when(order.createdAt)}</small></div><Pill status={quote.status} /></header>

    <section className="dq-card">
      <h3>Customer and address</h3>
      <dl className="dq-facts">
        <div><dt>Customer</dt><dd>{`${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || '—'}{order.customer.phone && <a className="dq-call" href={`tel:${order.customer.phone}`}><Phone size={13} />{order.customer.phone}</a>}</dd></div>
        <div><dt>Delivery address</dt><dd>{order.addressSnapshot || '—'}</dd></div>
        <div><dt>Nearest landmark</dt><dd>{quote.landmark || order.landmarkSnapshot || '—'}</dd></div>
        <div><dt>Directions</dt><dd>{quote.directions || '—'}</dd></div>
        <div><dt>Map pin</dt><dd>{drop ? <a href={mapsLink(drop.latitude, drop.longitude)} target="_blank" rel="noopener noreferrer"><MapPin size={13} />{drop.latitude.toFixed(5)}, {drop.longitude.toFixed(5)}</a> : 'No pin — use the address and landmark'}</dd></div>
        <div><dt>Store</dt><dd><Store size={13} /> {order.restaurant.name} — {order.restaurant.address}{pickup ? '' : ' (store hasn’t pinned its location)'}</dd></div>
        {pickup && drop && <div><dt>Route</dt><dd><a href={routeLink(pickup, drop)} target="_blank" rel="noopener noreferrer">Open the driving route (and alternatives) in Google Maps</a></dd></div>}
      </dl>
    </section>

    <section className="dq-card">
      <h3>What the system worked out</h3>
      <ul className="dq-reasons">{quote.reasonsText.map((reason) => <li key={reason}><AlertTriangle size={14} />{reason}</li>)}</ul>
      <dl className="dq-facts">
        <div><dt>Distance</dt><dd>{original.km != null ? `${original.km} km` : 'Not measured'}{original.roadKm != null ? ` (road ${original.roadKm} km)` : ''}{original.straightLineKm != null ? ` · straight line ${original.straightLineKm} km` : ''}</dd></div>
        <div><dt>Distance check</dt><dd>{(original.verificationStatus || '—').toLowerCase().replaceAll('_', ' ')} · confidence {(original.confidence || 'unverified').toLowerCase()} · route {(original.routeStatus || '—').toLowerCase().replaceAll('_', ' ')}</dd></div>
        <div><dt>Automatic estimate</dt><dd>{naira(quote.estimateFeeMinor)} <small>(not charged — for reference)</small></dd></div>
        {quote.correctedDistanceKm != null && <div><dt>Corrected distance</dt><dd>{quote.correctedDistanceKm} km — {quote.correctionReason}</dd></div>}
        <div><dt>Basket</dt><dd>{naira(order.subtotalMinor)} items + {naira(order.serviceFeeMinor)} service{order.tipMinor ? ` + ${naira(order.tipMinor)} tip` : ''}{order.discountMinor ? ` − ${naira(order.discountMinor)} promo` : ''} · pays by {order.payment?.method === 'BANK_TRANSFER' ? 'bank transfer' : 'card (Paystack)'}</dd></div>
      </dl>
    </section>

    {latestReview && quote.status === 'CUSTOMER_REVIEW_REQUESTED' && <section className="dq-card is-alert"><h3>The customer asked for a better price</h3><p>“{latestReview.customerMessage || 'No message'}”</p><small>On the offer of {naira(latestReview.feeMinor)}, {when(latestReview.respondedAt)}</small></section>}

    {open && order.status === 'AWAITING_DELIVERY_QUOTE' && <section className="dq-card">
      <h3><Bike size={16} /> Agree the price with riders</h3>
      <p className="dq-muted">Riders see the store, the drop-off area, landmark and distance — never the customer’s name, phone or exact address. Customers don’t take part; they only accept or decline the final price.</p>
      <div className="dq-ask">
        <label className="dq-field">Suggested rider pay (₦, optional)<input inputMode="numeric" value={ask.pay} onChange={(event) => setAsk({ ...ask, pay: event.target.value.replace(/[^\d]/g, '').slice(0, 6) })} placeholder="e.g. 1200" /></label>
        <label className="dq-field">Note to riders (optional)<input maxLength={200} value={ask.note} onChange={(event) => setAsk({ ...ask, note: event.target.value })} placeholder="e.g. Untarred road after the junction" /></label>
      </div>
      <div className="dq-actions"><button type="button" className="dq-ghost" disabled={Boolean(busy)} onClick={() => act('ask-riders', { ...(ask.pay ? { suggestedPayMinor: Number(ask.pay) * 100 } : {}), ...(ask.note.trim() ? { note: ask.note.trim() } : {}) }, quote.riderAskAt ? 'Ask riders again? They’ll get a new alert.' : null)}><Bike size={15} />{busy === 'ask-riders' ? 'Asking…' : quote.riderAskAt ? 'Ask riders again' : 'Ask riders'}</button>
        <button type="button" className="dq-link" onClick={loadRiderPrices}><RefreshCw size={13} />Refresh answers</button></div>
      {quote.riderAskAt && <small className="dq-muted">Asked {when(quote.riderAskAt)}{quote.riderAskPayMinor != null ? ` · suggested ${naira(quote.riderAskPayMinor)}` : ''}</small>}
      {riderPrices?.length ? <ul className="dq-rider-prices">{riderPrices.map((price) => <li key={price.riderId} className={`is-${price.response.toLowerCase()}`}>
        <span><b>{price.name}</b><small>{price.rating != null ? `★ ${price.rating.toFixed(1)} · ` : ''}{price.vehicle || 'Rider'}{price.phone ? <> · <a href={`tel:${price.phone}`}>{price.phone}</a></> : ''}</small>{price.note && <small>“{price.note}”</small>}</span>
        <span className="dq-rider-answer">{price.response === 'DECLINE' ? 'Not for them' : <><b>{naira(price.amountMinor)}</b><small>{price.response === 'AGREE' ? 'agreed' : 'their price'}</small></>}</span>
        {price.response !== 'DECLINE' && <button type="button" className={form.riderId === price.riderId ? 'dq-primary' : 'dq-ghost'} onClick={() => setForm({ ...form, riderId: form.riderId === price.riderId ? '' : price.riderId, riderPay: String(Math.round(price.amountMinor / 100)) })}>{form.riderId === price.riderId ? 'Chosen' : 'Use'}</button>}
      </li>)}</ul> : quote.riderAskAt ? <p className="dq-muted">No answers yet.</p> : null}
    </section>}

    {open && <section className="dq-card">
      <h3>{quote.currentVersion ? 'Send a revised price' : 'Set the delivery price'}</h3>
      <div className="dq-methods" role="radiogroup" aria-label="Pricing">
        {[['MANUAL_QUOTE', 'Delivery price'], ['NEGOTIATED', 'Special agreed price'], ['FREE_DELIVERY', 'Free delivery']].map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={form.method === value} className={form.method === value ? 'is-on' : ''} onClick={() => setForm({ ...form, method: value })}>{label}</button>)}
      </div>
      <label className="dq-field">Rider’s pay for this trip (₦)<input inputMode="numeric" value={form.riderPay} onChange={(event) => setForm({ ...form, riderPay: event.target.value.replace(/[^\d]/g, '').slice(0, 6), riderId: '' })} placeholder="e.g. 1200" /></label>
      {form.riderId && <small className="dq-muted">The rider who agreed this price will be offered the job first.</small>}
      {form.method !== 'FREE_DELIVERY' && <label className="dq-field">Delivery fee the customer pays (₦)<input inputMode="numeric" value={form.fee} onChange={(event) => setForm({ ...form, fee: event.target.value.replace(/[^\d]/g, '').slice(0, 7) })} placeholder="e.g. 1500" /></label>}
      {form.riderPay !== '' && (form.method === 'FREE_DELIVERY' || form.fee !== '') && <p className={`dq-margin ${(form.method === 'FREE_DELIVERY' ? 0 : Number(form.fee)) - Number(form.riderPay) < 0 ? 'is-loss' : ''}`}>DOORSTEP keeps {naira(((form.method === 'FREE_DELIVERY' ? 0 : Number(form.fee)) - Number(form.riderPay)) * 100)} of the delivery fee{(form.method === 'FREE_DELIVERY' ? 0 : Number(form.fee)) - Number(form.riderPay) < 0 ? ' — that’s a loss on this delivery' : ''}.</p>}
      <label className="dq-field">Message to the customer (optional)<textarea rows={2} maxLength={400} value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} placeholder="e.g. Your area is off the main road, so the rider needs extra time." /></label>
      <label className="dq-field">Price valid for<select value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })}>{[['2', '2 hours'], ['6', '6 hours'], ['12', '12 hours'], ['24', '1 day'], ['48', '2 days']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <details className="dq-more"><summary>Correct the distance or add a private note</summary>
        <label className="dq-field">Corrected road distance (km)<input inputMode="decimal" value={form.correctKm} onChange={(event) => setForm({ ...form, correctKm: event.target.value.replace(/[^\d.]/g, '').slice(0, 6) })} placeholder="e.g. 7.4" /></label>
        <label className="dq-field">Why (required with a correction)<input value={form.correctReason} maxLength={300} onChange={(event) => setForm({ ...form, correctReason: event.target.value })} placeholder="e.g. Checked the route by phone with the rider" /></label>
        <label className="dq-field">Private note (admins only)<textarea rows={2} maxLength={1000} value={form.internalNote} onChange={(event) => setForm({ ...form, internalNote: event.target.value })} /></label>
        <small className="dq-muted">The original distance is never changed; your correction is saved next to it.</small>
      </details>
      <div className="dq-actions">
        <button type="button" className="dq-primary" disabled={Boolean(busy)} onClick={send}><Check size={16} />{busy === 'offer' ? 'Sending…' : quote.currentVersion ? 'Send revised price' : 'Send price'}</button>
        {quote.status === 'CUSTOMER_REVIEW_REQUESTED' && <button type="button" className="dq-ghost" disabled={Boolean(busy)} onClick={() => { const message = window.prompt('Explain to the customer why the price stays the same:'); if (message && message.trim().length >= 3) act('keep', { message: message.trim() }) }}>Keep the price</button>}
        <button type="button" className="dq-ghost is-danger" disabled={Boolean(busy)} onClick={() => { const reason = window.prompt('Why can’t DOORSTEP deliver this order? The customer will see this.'); if (reason && reason.trim().length >= 3) act('cancel', { reason: reason.trim() }, 'Cancel this order? The customer hasn’t paid and will be told.') }}><X size={15} />Can’t deliver</button>
      </div>
    </section>}
    {result.text && <p className={`dq-msg is-${result.tone}`} role={result.tone === 'error' ? 'alert' : 'status'}>{result.text}</p>}

    <section className="dq-card">
      <h3>Price history</h3>
      {quote.versions.length ? <ul className="dq-versions">{quote.versions.map((version) => <li key={version.id}><b>v{version.version} · {naira(version.feeMinor)}{version.riderPayMinor != null ? ` · rider ${naira(version.riderPayMinor)}` : ''}</b><span>{version.status.toLowerCase().replaceAll('_', ' ')} · by {version.proposedBy} · {when(version.createdAt)}{version.expiresAt ? ` · valid until ${when(version.expiresAt)}` : ''}</span>{version.explanation && <small>To customer: “{version.explanation}”</small>}{version.internalNote && <small>Private: {version.internalNote}</small>}{version.customerResponse && <small>Customer: {version.customerResponse.toLowerCase()}{version.customerMessage ? ` — “${version.customerMessage}”` : ''} ({when(version.respondedAt)})</small>}</li>)}</ul> : <p className="dq-muted">No price sent yet.</p>}
      <h3>Everything that happened</h3>
      <ol className="dq-timeline">{quote.events.map((event) => <li key={event.id}><b>{EVENT_TEXT[event.type] || event.type}</b><span>{event.actor} · {when(event.createdAt)}{event.toFeeMinor != null ? ` · ${event.fromFeeMinor != null ? `${naira(event.fromFeeMinor)} → ` : ''}${naira(event.toFeeMinor)}` : ''}</span>{event.message && <small>{event.message}</small>}</li>)}</ol>
    </section>
  </div>
}

export function DeliveryQuotes() {
  const [tab, setTab] = useState('todo')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get('id'))
  const load = useCallback(() => {
    setError('')
    call(`/api/admin/delivery-quotes?tab=${tab}&page=${page}${search ? `&q=${encodeURIComponent(search)}` : ''}`).then(setData).catch((loadError) => setError(loadError.status === 401 ? 'You’ve been signed out. Sign in again.' : loadError.message))
  }, [tab, page, search])
  useEffect(() => { load() }, [load])
  useEffect(() => { const timer = window.setInterval(() => { if (!document.hidden && !selected) load() }, 30_000); return () => window.clearInterval(timer) }, [load, selected])
  if (selected) return <div className="ph-page dq-page"><Detail id={selected} onBack={() => setSelected(null)} onChanged={load} /></div>
  const tabs = [['todo', 'Needs you', data?.counts.todo], ['customer', 'Waiting for customer', data?.counts.customer], ['done', 'Finished'], ['all', 'All']]
  return <div className="ph-page dq-page">
    <Overview />
    <div className="dq-tabs" role="tablist">{tabs.map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-on' : ''} onClick={() => { setTab(key); setPage(0) }}>{label}{count ? <span>{count}</span> : null}</button>)}</div>
    <form className="dq-search" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); setPage(0) }}><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order number, customer, phone or address" aria-label="Search requests" /><button type="submit">Search</button></form>
    {error && <p className="dq-msg is-error">{error} <button type="button" className="dq-link" onClick={load}><RefreshCw size={13} />Try again</button></p>}
    {!data && !error && <p className="dq-muted">Loading…</p>}
    {data && (data.quotes.length ? <ul className="dq-list">{data.quotes.map((quote) => <li key={quote.id}><button type="button" onClick={() => setSelected(quote.id)}>
      <span className="dq-row-main"><b>{quote.order.orderNumber}</b><small>{quote.order.customer || 'Customer'} · {quote.order.store}</small><small className="dq-addr">{quote.order.addressSnapshot}{quote.order.landmarkSnapshot ? ` · near ${quote.order.landmarkSnapshot}` : ''}</small><span className="dq-tags">{quote.reasons.map((reason) => <i key={reason}>{REASONS[reason] || reason}</i>)}</span></span>
      <span className="dq-row-side"><Pill status={quote.status} /><small>{quote.latestFeeMinor != null ? naira(quote.latestFeeMinor) : `est. ${naira(quote.estimateFeeMinor)}`}</small><small><Clock3 size={12} /> {when(quote.updatedAt)}</small></span>
      <ChevronRight size={18} aria-hidden="true" className="dq-chev" />
    </button></li>)}</ul> : <div className="dq-empty"><Check size={22} /><b>{tab === 'todo' ? 'Nothing waiting for you' : 'No requests here'}</b><small>{tab === 'todo' ? 'When a customer’s address can’t be priced automatically, it appears here.' : 'Try another tab or search.'}</small></div>)}
    {data && data.total > data.pageSize && <div className="dq-pager"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(data.total / data.pageSize)}</span><button type="button" disabled={(page + 1) * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
  </div>
}

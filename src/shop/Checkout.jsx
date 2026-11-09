import { useEffect, useMemo, useState } from 'react'
import { Bike, CalendarClock, Check, ChevronRight, Clock3, CreditCard, HandHeart, Info, Landmark, MapPin, Minus, Navigation, Plus, ShieldCheck, ShoppingBag, Store, Tag, Trash2, X, Zap } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { SavedCardChoices, useSavedCards } from '../account/SavedCards'
import { AddressSheet, EmptyState, ShopHeader } from './ShopKit'
import { FeesInfo, readOrderType, writeOrderType } from './StorePage'
import { authHeaders, buildOrderRequest, changeItem, choicesText, lineKey, currentAddress, etaText, naira, navigate, nairaWhole, placeOrder, saveTip, savedTip, token, useAddress, useCart, useCheckoutQuote, useDeliveryCheck, useHome } from './shopData'

const TIP_CHOICES = [0, 20_000, 30_000, 50_000]
const hash = (text) => { let value = 0; for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) | 0; return (value >>> 0).toString(36) }
const toMinutes = (value) => { const [hour, minute] = String(value || '').split(':').map(Number); return Number.isFinite(hour) ? hour * 60 + (minute || 0) : null }
const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

/** Delivery slots every 30 minutes inside the store's hours, from 45 minutes from now, for the next 7 days. */
export function scheduleDays(store, now = new Date()) {
  const open = toMinutes(store?.openingTime) ?? 8 * 60
  let close = toMinutes(store?.closingTime) ?? 21 * 60
  if (close <= open) close += 24 * 60
  const daysOpen = Array.isArray(store?.daysOpen) && store.daysOpen.length ? store.daysOpen : DAY_NAMES
  const earliest = now.getTime() + 45 * 60_000
  const days = []
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    if (!daysOpen.includes(DAY_NAMES[day.getDay()])) continue
    const slots = []
    for (let minute = Math.ceil(open / 30) * 30; minute <= close - 15; minute += 30) {
      const at = new Date(day.getTime() + minute * 60_000)
      if (at.getTime() >= earliest) slots.push(at)
    }
    if (slots.length) days.push({ date: day, label: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : day.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric' }), slots })
  }
  return days
}
const timeLabel = (date) => date.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })

function usePaymentConfig() {
  const [config, setConfig] = useState(null)
  useEffect(() => { fetch(`${apiBase}/api/payments/config`).then((response) => response.ok ? response.json() : null).then(setConfig).catch(() => setConfig({ methods: {} })) }, [])
  return config
}
function usePhone() {
  const [phone, setPhone] = useState('')
  useEffect(() => { if (!token()) return; fetch(`${apiBase}/api/auth/me`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (body?.user?.phone) setPhone((current) => current || body.user.phone) }).catch(() => undefined) }, [])
  return [phone, setPhone]
}

function Row({ label, value, strike, tone, hint }) {
  return <div className={`sp-sum-row${tone ? ` is-${tone}` : ''}`}><dt>{label}{hint && <small>{hint}</small>}</dt><dd>{strike && <s>{strike}</s>}{value}</dd></div>
}

export function CheckoutPage() {
  const { cart, count, subtotal } = useCart()
  const home = useHome()
  const address = useAddress()
  const check = useDeliveryCheck(address)
  const store = home.data?.stores.find((entry) => entry.id === cart[0]?.restaurantId) || null
  const [orderType, setOrderType] = useState(readOrderType)
  const pickup = orderType === 'PICKUP' && store?.pickupEnabled !== false
  const [when, setWhen] = useState('NOW')
  const [slot, setSlot] = useState(null)
  const [dayIndex, setDayIndex] = useState(0)
  const [tip, setTip] = useState(savedTip)
  const [customTip, setCustomTip] = useState('')
  const [keepTip, setKeepTip] = useState(() => savedTip() > 0)
  const [promoInput, setPromoInput] = useState('')
  const [promoCode, setPromoCode] = useState('')
  // The landmark saved with the address comes along; it can still be changed for this order.
  const [landmark, setLandmark] = useState(() => currentAddress().landmark || '')
  // Switching to another saved address brings its landmark.
  useEffect(() => { if (address.landmark) setLandmark(address.landmark) }, [address.savedAddressId, address.landmark])
  const [phone, setPhone] = usePhone()
  // Extra directions for addresses the map can't find (sent with orders whose delivery fee needs confirming).
  const [directions, setDirections] = useState('')
  const [method, setMethod] = useState('PAYSTACK')
  const [cardChoice, setCardChoice] = useState('NEW')
  const [saveCard, setSaveCard] = useState(false)
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [nonce] = useState(() => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const config = usePaymentConfig()
  const savedCards = useSavedCards()
  // Start on the customer's default card (cards arrive default-first), unless they already picked something.
  useEffect(() => { const preferred = savedCards.cards.find((card) => !card.expired); if (preferred) setCardChoice((current) => current === 'NEW' ? preferred.id : current) }, [savedCards.cards.length])
  const days = useMemo(() => scheduleDays(store), [store?.id])
  const storeClosed = store && !store.openNow

  useEffect(() => { if (storeClosed && when === 'NOW') setWhen('LATER') }, [storeClosed])
  useEffect(() => { const first = savedCards.cards.find((card) => !card.expired); if (first) setCardChoice((current) => current === 'NEW' ? first.id : current) }, [savedCards.cards.length])
  useEffect(() => { if (config && !config.methods?.paystack?.enabled && config.methods?.bankTransfer?.enabled) setMethod('BANK_TRANSFER') }, [config])

  const scheduledFor = when === 'LATER' && slot ? slot.toISOString() : null
  const tipMinor = pickup ? 0 : customTip ? Math.max(0, Math.round(Number(customTip) * 100) || 0) : tip
  const request = useMemo(() => buildOrderRequest(cart, { orderType: pickup ? 'PICKUP' : 'DELIVERY', address, scheduledFor, tipMinor, promoCode, landmark, phone, paymentMethod: method, deliveryInstructions: directions }), [cart, pickup, address.label, address.point?.latitude, address.point?.longitude, address.savedAddressId, scheduledFor, tipMinor, promoCode, landmark, phone, method])
  const quoteState = useCheckoutQuote(request)
  const quote = quoteState.status === 'ready' ? quoteState.quote : null

  if (!count) return <div className="sp-screen sp-checkout"><ShopHeader title="Basket" back="/" search={false} /><main className="sp-main"><EmptyState icon={ShoppingBag} title="Your basket is empty" body="Add something from a store and it’ll show up here." action={<button type="button" className="sp-primary" onClick={() => navigate('/')}>Start shopping</button>} /></main></div>

  const signedIn = Boolean(token())
  const methods = [
    { value: 'PAYSTACK', label: 'Card, bank or USSD', detail: 'Pay securely with Paystack', icon: CreditCard, enabled: config?.methods?.paystack?.enabled },
    { value: 'BANK_TRANSFER', label: 'Bank transfer', detail: 'Send to DOORSTEP’s account and upload your receipt', icon: Landmark, enabled: config?.methods?.bankTransfer?.enabled },
  ].filter((entry) => entry.enabled)
  const outside = !pickup && check && check.deliverable === false
  const needsSlot = when === 'LATER' && !slot
  const canPay = signedIn && quote && !busy && !outside && !needsSlot && methods.length > 0 && phone.trim().length >= 7
  // The delivery fee needs a quick check by DOORSTEP: the order is sent, and paid only after the price is accepted.
  const confirmFee = Boolean(!pickup && quote?.deliveryQuoteRequired)
  const payLabel = (prefix) => confirmFee ? 'Send order for a delivery price' : `${prefix}${quote ? ` · ${naira(quote.totalMinor)}` : ''}`
  const choose = (value) => { setOrderType(value); writeOrderType(value) }
  const freeDelivery = quote?.promotion?.type === 'FREE_DELIVERY' && quote.discountMinor >= quote.deliveryFeeMinor && quote.deliveryFeeMinor > 0

  const submit = async () => {
    if (!canPay) return
    setBusy(true); setError('')
    if (!pickup) saveTip(keepTip ? tipMinor : 0)
    try {
      const key = `co-${nonce.slice(0, 18)}-${hash(JSON.stringify(request))}`
      const result = await placeOrder(request, { idempotencyKey: key, savedCardId: method === 'PAYSTACK' && savedCards.enabled && cardChoice !== 'NEW' ? cardChoice : null, saveCard: method === 'PAYSTACK' && cardChoice === 'NEW' && saveCard })
      if (result.redirect) { window.location.assign(result.redirect); return }
      navigate(result.next)
    } catch (submitError) {
      setError(submitError.message)
      if (submitError.orderId) window.setTimeout(() => navigate(`/account/orders/${submitError.orderId}`), 2500)
    } finally { setBusy(false) }
  }

  return <div className="sp-screen sp-checkout">
    <ShopHeader title="Checkout" back={cart[0]?.restaurantSlug ? `/store/${cart[0].restaurantSlug}` : '/'} search={false} />
    <main className="sp-main sp-checkout-main">
      {!signedIn && <div className="sp-signin-card"><ShieldCheck size={20} aria-hidden="true" /><div><b>Sign in to place your order</b><small>Your basket is saved on this device.</small></div><button type="button" className="sp-primary" onClick={() => navigate('/login')}>Sign in</button></div>}

      <section className="sp-card">
        <div className="sp-card-head"><h2>{cart[0].restaurantName}</h2>{cart[0].restaurantSlug && <button type="button" className="sp-link" onClick={() => navigate(`/store/${cart[0].restaurantSlug}`)}>Add more</button>}</div>
        <ul className="sp-basket-items">{cart.map((item) => <li key={lineKey(item)}>
          <div className="sp-stepper is-small"><button type="button" onClick={() => changeItem(lineKey(item), -1)} aria-label={item.quantity === 1 ? `Remove ${item.name}` : `One less ${item.name}`}>{item.quantity === 1 ? <Trash2 size={14} /> : <Minus size={14} />}</button><span>{item.quantity}</span><button type="button" onClick={() => changeItem(lineKey(item), 1)} aria-label={`One more ${item.name}`}><Plus size={14} /></button></div>
          <span className="sp-basket-name"><b>{item.name}</b>{item.options?.length > 0 && <small className="sp-basket-choices">{choicesText(item.options)}</small>}{item.instructions && <small>“{item.instructions}”</small>}</span>
          <strong>{nairaWhole(item.price * item.quantity)}</strong>
        </li>)}</ul>
      </section>

      {store?.pickupEnabled && <div className="sp-mode-toggle is-wide" role="radiogroup" aria-label="Delivery or pickup">
        <button type="button" role="radio" aria-checked={!pickup} className={!pickup ? 'is-on' : ''} onClick={() => choose('DELIVERY')}><Bike size={16} aria-hidden="true" />Delivery</button>
        <button type="button" role="radio" aria-checked={pickup} className={pickup ? 'is-on' : ''} onClick={() => choose('PICKUP')}><Store size={16} aria-hidden="true" />Pickup</button>
      </div>}

      <section className="sp-card">
        <h2>{pickup ? 'Pick up from' : 'Deliver to'}</h2>
        {pickup ? <div className="sp-place-row"><span className="sp-place-icon" aria-hidden="true"><Store size={18} /></span><span><b>{store?.name || cart[0].restaurantName}</b><small>{quote?.pickupAddress || store?.address || 'Store address shown after pricing'}</small></span>{store?.latitude != null && <a className="sp-link" href={`https://www.google.com/maps/dir/?api=1&destination=${store.latitude},${store.longitude}`} target="_blank" rel="noreferrer"><Navigation size={14} aria-hidden="true" /> Directions</a>}</div>
          : <button type="button" className={`sp-place-row is-button${outside ? ' is-out' : ''}`} onClick={() => setSheet('address')}><span className="sp-place-icon" aria-hidden="true"><MapPin size={18} /></span><span><b>{address.label || 'Choose your address'}</b><small>{outside ? check.message : address.point ? 'Exact pin set' : 'Pin your spot for the exact fee'}</small></span><ChevronRight size={17} aria-hidden="true" /></button>}
        {!pickup && !address.point && <button type="button" className="sp-pin-prompt" onClick={() => navigate('/location?return=/checkout')}><MapPin size={18} aria-hidden="true" /><span><b>Pin your exact spot</b><small>Your delivery fee is based on distance. Without a pin we can only estimate it.</small></span><ChevronRight size={17} aria-hidden="true" /></button>}
        {!pickup && <label className="sp-field">Landmark or directions for the rider<input value={landmark} maxLength={200} onChange={(event) => setLandmark(event.target.value)} placeholder="e.g. blue gate opposite the church" /></label>}
        <label className="sp-field">Phone number<input value={phone} inputMode="tel" maxLength={30} onChange={(event) => setPhone(event.target.value)} placeholder="080 0000 0000" required /></label>
      </section>

      <section className="sp-card">
        <h2>{pickup ? 'Pickup time' : 'Delivery time'}</h2>
        <div className="sp-option-list" role="radiogroup">
          <button type="button" role="radio" aria-checked={when === 'NOW'} disabled={storeClosed} className={when === 'NOW' ? 'is-on' : ''} onClick={() => setWhen('NOW')}><Zap size={18} aria-hidden="true" /><span><b>Standard</b><small>{storeClosed ? 'The store is closed right now' : `${etaText(pickup ? store?.pickupEta : store?.eta) || 'As soon as possible'}`}</small></span>{when === 'NOW' && <Check size={17} aria-hidden="true" />}</button>
          <button type="button" role="radio" aria-checked={when === 'LATER'} className={when === 'LATER' ? 'is-on' : ''} onClick={() => setWhen('LATER')}><CalendarClock size={18} aria-hidden="true" /><span><b>Schedule</b><small>{slot ? `${days.find((day) => day.slots.includes(slot))?.label || ''} at ${timeLabel(slot)}` : 'Choose a time'}</small></span>{when === 'LATER' && <Check size={17} aria-hidden="true" />}</button>
        </div>
        {when === 'LATER' && (days.length ? <div className="sp-schedule">
          <div className="sp-day-chips">{days.map((day, index) => <button key={day.label} type="button" className={dayIndex === index ? 'is-on' : ''} onClick={() => setDayIndex(index)}>{day.label}</button>)}</div>
          <div className="sp-slot-grid">{(days[dayIndex] || days[0]).slots.map((at) => <button key={at.toISOString()} type="button" className={slot?.getTime() === at.getTime() ? 'is-on' : ''} onClick={() => setSlot(at)}>{timeLabel(at)}</button>)}</div>
        </div> : <p className="sp-note">This store has no open times in the next week.</p>)}
      </section>

      <section className="sp-card">
        <h2>Payment method</h2>
        {config == null ? <p className="sp-note">Loading payment methods…</p> : methods.length === 0 ? <p className="sp-note" role="alert">No payment method is switched on right now. Please contact DOORSTEP support.</p>
          : <div className="sp-option-list" role="radiogroup">{methods.map(({ value, label, detail, icon: Icon }) => <button key={value} type="button" role="radio" aria-checked={method === value} className={method === value ? 'is-on' : ''} onClick={() => setMethod(value)}><Icon size={18} aria-hidden="true" /><span><b>{label}</b><small>{detail}</small></span>{method === value && <Check size={17} aria-hidden="true" />}</button>)}</div>}
        {method === 'PAYSTACK' && savedCards.enabled && <SavedCardChoices cards={savedCards.cards} value={cardChoice} onChange={setCardChoice} saveCard={saveCard} onSaveCardChange={setSaveCard} enabled={savedCards.enabled} name="shop-card" />}
        <p className="sp-fineprint"><ShieldCheck size={13} aria-hidden="true" />Card details are entered on Paystack’s secure page — DOORSTEP never sees your card number.</p>
      </section>

      <section className="sp-card">
        <h2>Promo code</h2>
        {quote?.promotion ? <div className="sp-promo-applied"><Tag size={16} aria-hidden="true" /><span><b>{quote.promotion.label}</b><small>{quote.promotion.auto ? 'Applied automatically' : `Code ${quote.promotion.code}`}{quote.promotion.capped ? ' · capped for this order' : ''}</small></span>{!quote.promotion.auto && <button type="button" className="sp-icon-btn" onClick={() => { setPromoCode(''); setPromoInput('') }} aria-label="Remove promo code"><X size={16} /></button>}</div> : null}
        {!quote?.promotion || quote.promotion.auto ? <form className="sp-promo-form" onSubmit={(event) => { event.preventDefault(); setPromoCode(promoInput.trim().toUpperCase()) }}>
          <input value={promoInput} onChange={(event) => setPromoInput(event.target.value.toUpperCase())} placeholder="Enter code" aria-label="Promo code" maxLength={24} autoCapitalize="characters" />
          <button type="submit" className="sp-ghost" disabled={!promoInput.trim()}>Apply</button>
        </form> : null}
        {quote?.promoProblem && promoCode && <p className="sp-error" role="alert">{quote.promoProblem.message}</p>}
      </section>

      {!pickup && <section className="sp-card">
        <h2><HandHeart size={18} aria-hidden="true" /> Tip your rider</h2>
        <p className="sp-note">100% of the tip goes to the rider who brings your order.</p>
        <div className="sp-tip-chips">{TIP_CHOICES.map((value) => <button key={value} type="button" className={!customTip && tip === value ? 'is-on' : ''} onClick={() => { setTip(value); setCustomTip('') }}>{value ? naira(value) : 'No tip'}</button>)}
          <label className={`sp-tip-other${customTip ? ' is-on' : ''}`}><span>₦</span><input inputMode="numeric" value={customTip} onChange={(event) => setCustomTip(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Other" aria-label="Other tip amount in naira" /></label>
        </div>
        <label className="sp-check-row"><input type="checkbox" checked={keepTip} onChange={(event) => setKeepTip(event.target.checked)} />Save tip for next orders</label>
      </section>}

      <section className="sp-card sp-summary">
        <div className="sp-card-head"><h2>Summary</h2><button type="button" className="sp-link" onClick={() => setSheet('fees')}><Info size={14} aria-hidden="true" />Fees information</button></div>
        <dl>
          <Row label="Products" value={nairaWhole(subtotal)} />
          {!pickup && confirmFee && <Row label="Delivery" value="To be confirmed" />}
          {!pickup && !confirmFee && <Row label="Delivery" value={quote ? (freeDelivery ? 'Free' : naira(quote.deliveryFeeMinor)) : '…'} strike={freeDelivery ? naira(quote.deliveryFeeMinor) : null} tone={freeDelivery ? 'good' : null} />}
          <Row label="Services" value={quote ? naira(quote.serviceFeeMinor) : '…'} />
          {quote?.tipMinor > 0 && <Row label="Rider tip" value={naira(quote.tipMinor)} />}
          {quote?.discountMinor > 0 && !freeDelivery && <Row label={quote.promotion?.label || 'Promo'} value={`−${naira(quote.discountMinor)}`} tone="good" />}
          {quote?.discountMinor > 0 && freeDelivery && quote.discountMinor > quote.deliveryFeeMinor && <Row label="Promo" value={`−${naira(quote.discountMinor - quote.deliveryFeeMinor)}`} tone="good" />}
          <Row label={confirmFee ? 'Total before delivery' : 'Total'} value={quote ? naira(quote.totalMinor) : '…'} tone="total" />
        </dl>
        {confirmFee && <div className="sp-confirm-fee" role="status">
          <b>Your delivery fee is awaiting confirmation</b>
          <p>{quote.delivery?.message}</p>
          <label>Directions for the rider (optional)<textarea rows={2} maxLength={300} value={directions} onChange={(event) => setDirections(event.target.value)} placeholder="e.g. After the church, second gate on the left" /></label>
          <small>You won’t be charged now. You’ll see the delivery price, then accept it and pay — or decline it.</small>
        </div>}
        {quoteState.status === 'loading' && <p className="sp-note">Updating price…</p>}
        {quoteState.status === 'error' && <p className="sp-error" role="alert">{quoteState.error}</p>}
        {!request && !pickup && <p className="sp-note">Choose your delivery address to see the delivery fee.</p>}
        <button type="button" className="sp-primary is-wide sp-desktop-pay" disabled={signedIn && !canPay} onClick={signedIn ? submit : () => navigate('/login')}>{busy ? (confirmFee ? 'Sending…' : 'Placing your order…') : !signedIn ? 'Sign in to order' : outside ? 'Address outside delivery area' : needsSlot ? 'Choose a time' : phone.trim().length < 7 ? 'Add your phone number' : payLabel('Order and pay')}</button>
      </section>
      {error && <p className="sp-error is-block" role="alert">{error}</p>}
    </main>
    <div className="sp-pay-bar">
      <button type="button" className="sp-primary is-wide" disabled={signedIn && !canPay} onClick={signedIn ? submit : () => navigate('/login')}>{busy ? (confirmFee ? 'Sending…' : 'Placing your order…') : !signedIn ? 'Sign in to order' : outside ? 'Address outside delivery area' : needsSlot ? 'Choose a time' : phone.trim().length < 7 ? 'Add your phone number' : payLabel(method === 'BANK_TRANSFER' ? 'Order and pay by transfer' : 'Order and pay')}</button>
      {when === 'LATER' && slot && <small><Clock3 size={12} aria-hidden="true" /> {pickup ? 'Ready to collect' : 'Arrives'} around {timeLabel(slot)}</small>}
    </div>
    {sheet === 'address' && <AddressSheet onClose={() => setSheet(null)} />}
    {sheet === 'fees' && <FeesInfo onClose={() => setSheet(null)} />}
  </div>
}

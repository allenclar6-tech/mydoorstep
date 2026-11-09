import { useEffect, useState } from 'react'
import { Bike, ChevronRight, Clock3, MapPin, MessageSquareText, ThumbsDown, ThumbsUp } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { Sheet } from './ShopKit'
import { toast } from './Toaster'
import { authHeaders, etaText, ratingPercent, token, useAddress } from './shopData'

// Glovo-style reviews on the store page: a "Reviews" tab and section, the full list, reviews about one item,
// and "Rate your order" for customers with a delivered order from this store. Plus the facts row with the real
// delivery fee — struck through, with a red “Free”, when delivery is free.

const dateText = (value) => new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
const nairaExact = (minor) => `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Thumbs-up share for one item, once at least 3 people rated it. */
export function itemRating(stats, itemId) {
  const row = stats?.[itemId]
  if (!row || row.total < 3) return null
  return { percent: Math.round((row.liked / row.total) * 100), total: row.total }
}

export function ReviewCard({ review, compact = false }) {
  const Thumb = review.liked ? ThumbsUp : ThumbsDown
  const ordered = review.items.map((item) => item.name).join(', ')
  return <article className={`rv-card${compact ? ' is-compact' : ''}`}>
    <header><span className="rv-avatar" aria-hidden="true">{review.author.charAt(0)}</span><span><b>{review.author}</b><small>{dateText(review.createdAt)}</small></span>
      <span className={`rv-thumb${review.liked ? ' is-up' : ' is-down'}`} aria-label={review.liked ? 'Liked it' : 'Didn’t like it'}><Thumb size={15} /></span></header>
    {review.body ? <p>{review.body}</p> : <p className="rv-muted">{review.liked ? 'Liked the order.' : 'Didn’t like the order.'}</p>}
    {ordered && <small className="rv-ordered">Ordered: {ordered}</small>}
    {!compact && review.itemFeedback.length > 0 && <ul className="rv-items">{review.itemFeedback.map((entry) => <li key={entry.menuItemId} className={entry.liked ? 'is-up' : 'is-down'}>{entry.liked ? <ThumbsUp size={12} aria-hidden="true" /> : <ThumbsDown size={12} aria-hidden="true" />}{entry.name}</li>)}</ul>}
  </article>
}

/** All reviews (paginated). With `item`, only reviews about that item. */
export function ReviewsSheet({ store, item, onClose, onRate, canRate }) {
  const [state, setState] = useState({ list: [], cursor: null, loading: true, error: '' })
  const load = (cursor = null) => {
    setState((current) => ({ ...current, loading: true, error: '' }))
    const query = new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}), ...(item ? { itemId: item.id } : {}) })
    fetch(`${apiBase}/api/app/stores/${encodeURIComponent(store.slug)}/reviews?${query}`).then((response) => response.ok ? response.json() : Promise.reject(new Error()))
      .then((body) => setState((current) => ({ list: cursor ? [...current.list, ...body.reviews] : body.reviews, cursor: body.nextCursor, loading: false, error: '' })))
      .catch(() => setState((current) => ({ ...current, loading: false, error: 'Couldn’t load reviews. Check your internet.' })))
  }
  useEffect(() => { load() }, [store.slug, item?.id])
  const percent = ratingPercent(store)
  return <Sheet title={item ? `Reviews: ${item.name}` : 'Ratings & reviews'} onClose={onClose} className="rv-sheet">
    {!item && <div className="rv-summary">
      <span className="rv-blob is-mint" aria-hidden="true"><ThumbsUp size={26} /></span>
      <div><b>{percent != null ? `${percent}%` : 'New'}</b><span>{store.ratingCount ? `${store.ratingCount} rating${store.ratingCount === 1 ? '' : 's'} · ${percent}% liked their order` : 'No ratings yet'}</span></div>
    </div>}
    {canRate && <button type="button" className="rv-rate-cta" onClick={onRate}><MessageSquareText size={18} aria-hidden="true" /><span><b>Rate your order</b><small>Tell others what you thought</small></span><ChevronRight size={18} aria-hidden="true" /></button>}
    {state.list.length > 0 && <div className="rv-list">{state.list.map((review) => <ReviewCard key={review.id} review={review} />)}</div>}
    {!state.loading && !state.error && state.list.length === 0 && <p className="sp-note">{item ? 'No reviews mention this item yet.' : 'Reviews appear here after customers rate their delivered orders.'}</p>}
    {state.error && <p className="sp-note" role="alert">{state.error}</p>}
    {state.loading && <div className="sp-skeletons"><div className="sp-skeleton" /></div>}
    {state.cursor && !state.loading && <button type="button" className="sp-ghost rv-more" onClick={() => load(state.cursor)}>Show more reviews</button>}
  </Sheet>
}

/** Delivered orders from this store the customer can still rate. */
export function useReviewable(slug) {
  const [orders, setOrders] = useState([])
  const load = () => { if (!token()) return; fetch(`${apiBase}/api/app/stores/${encodeURIComponent(slug)}/my-reviewable`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => setOrders(body?.orders || [])).catch(() => undefined) }
  useEffect(load, [slug])
  return [orders, load]
}

/** Thumbs for the order, thumbs for each item, an optional comment. */
export function RateSheet({ store, order, onClose, onDone }) {
  const [liked, setLiked] = useState(null)
  const [items, setItems] = useState({})
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rateable = order.items.filter((item) => item.menuItemId)
  const submit = async () => {
    if (liked == null) { setError('Tap 👍 or 👎 first.'); return }
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiBase}/api/reviews`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ orderId: order.id, rating: liked ? 5 : 1, ...(body.trim() ? { body: body.trim() } : {}), items: Object.entries(items).map(([menuItemId, value]) => ({ menuItemId, liked: value })) }) })
      if (response.status === 409) throw new Error('This order has already been rated.')
      if (!response.ok) throw new Error('Couldn’t send your review. Try again.')
      toast('Thanks for your review!')
      onDone()
    } catch (submitError) { setError(submitError instanceof TypeError ? 'No internet. Try again when you’re back online.' : submitError.message) } finally { setBusy(false) }
  }
  return <Sheet title={`How was ${store.name}?`} onClose={onClose} className="rv-rate">
    <p className="sp-note">Order {order.orderNumber} · {dateText(order.deliveredAt)}</p>
    <div className="rv-big-thumbs" role="radiogroup" aria-label="Did you like your order?">
      <button type="button" role="radio" aria-checked={liked === true} className={liked === true ? 'is-up' : ''} onClick={() => setLiked(true)}><ThumbsUp size={30} aria-hidden="true" /><span>Good</span></button>
      <button type="button" role="radio" aria-checked={liked === false} className={liked === false ? 'is-down' : ''} onClick={() => setLiked(false)}><ThumbsDown size={30} aria-hidden="true" /><span>Not good</span></button>
    </div>
    {rateable.length > 0 && <>
      <h3 className="sp-sheet-sub">Rate what you ordered <em>(optional)</em></h3>
      <ul className="rv-rate-items">{rateable.map((item) => <li key={item.menuItemId}><span>{item.quantity > 1 ? `${item.quantity} × ` : ''}{item.name}</span>
        <button type="button" aria-pressed={items[item.menuItemId] === true} aria-label={`Liked ${item.name}`} className={items[item.menuItemId] === true ? 'is-up' : ''} onClick={() => setItems({ ...items, [item.menuItemId]: items[item.menuItemId] === true ? undefined : true })}><ThumbsUp size={17} /></button>
        <button type="button" aria-pressed={items[item.menuItemId] === false} aria-label={`Didn’t like ${item.name}`} className={items[item.menuItemId] === false ? 'is-down' : ''} onClick={() => setItems({ ...items, [item.menuItemId]: items[item.menuItemId] === false ? undefined : false })}><ThumbsDown size={17} /></button>
      </li>)}</ul>
    </>}
    <label className="sp-field">Tell others more <em>(optional)</em><textarea rows={3} maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} placeholder={liked === false ? 'What went wrong? The store will see this.' : 'What did you love?'} /></label>
    {error && <p className="ae-error" role="alert">{error}</p>}
    <button type="button" className="sp-primary is-wide" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send review'}</button>
    <p className="sp-note rv-fineprint">Reviews show your first name and initial. DOORSTEP checks each review before it appears.</p>
  </Sheet>
}

/** The store’s real delivery fee for the current address (pin, or typed area). */
export function useStoreDeliveryFee(store, subtotalMinor) {
  const address = useAddress()
  const [fee, setFee] = useState(null)
  const key = `${store?.slug}|${address.point ? `${address.point.latitude},${address.point.longitude}` : address.label}|${Math.round(subtotalMinor / 50000)}`
  useEffect(() => {
    if (!store || (!address.point && !address.label)) { setFee(null); return undefined }
    let active = true
    fetch(`${apiBase}/api/app/stores/${encodeURIComponent(store.slug)}/delivery-fee`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(address.point ? { latitude: address.point.latitude, longitude: address.point.longitude } : {}), ...(address.label ? { addressLine: address.label.slice(0, 240) } : {}), subtotalMinor }) })
      .then((response) => response.ok ? response.json() : null).then((body) => { if (active) setFee(body) }).catch(() => undefined)
    return () => { active = false }
  }, [key])
  return fee
}

/** Thumbs · time · delivery fee, with coloured blobs like Glovo. */
export function StoreFactsRow({ store, orderType, free, fee, reviewCount, onReviews }) {
  const percent = ratingPercent(store)
  const pickup = orderType === 'PICKUP'
  const feeMinor = fee?.feeMinor
  return <div className="rv-facts">
    <div className="rv-fact">
      <span className="rv-blob is-mint" aria-hidden="true"><ThumbsUp size={24} /></span>
      <b>{percent != null ? `${percent}% (${store.ratingCount})` : 'New'}</b>
      <button type="button" className="rv-link" onClick={onReviews}>{reviewCount > 20 ? '20+ reviews' : reviewCount > 0 ? `${reviewCount} review${reviewCount === 1 ? '' : 's'}` : 'Reviews'}</button>
    </div>
    <div className="rv-fact">
      <span className="rv-blob is-sun" aria-hidden="true"><Clock3 size={24} /></span>
      <b>{etaText(pickup ? store.pickupEta : store.eta)}</b>
      <small>{pickup ? 'Ready to collect' : 'Delivery time'}</small>
    </div>
    <div className="rv-fact">
      <span className="rv-blob is-sun" aria-hidden="true">{pickup ? <MapPin size={24} /> : <Bike size={24} />}</span>
      {pickup ? <><b>No fee</b><small>You collect</small></>
        : free ? <>{feeMinor ? <s className="rv-was">{nairaExact(feeMinor)}</s> : <s className="rv-was">Delivery fee</s>}<span className="rv-free">Free</span></>
          : fee?.toBeConfirmed ? <><b>To be confirmed</b><small>We’ll confirm the fee before you pay</small></>
          : feeMinor ? <><b>{nairaExact(feeMinor)}</b><small>{fee.exact ? 'Delivery fee' : 'Fee for your area'}</small></>
            : <><b>By distance</b><small>{fee?.problem || 'Set your address'}</small></>}
    </div>
  </div>
}

/** “Reviews” section in the menu: a swipeable row of the newest reviews. */
export function ReviewsSection({ reviews, reviewCount, onAll, canRate, onRate, sectionRef }) {
  return <section className="sp-menu-section rv-section" ref={sectionRef}>
    <div className="rv-section-head"><h2>Reviews</h2>{reviewCount > 0 && <button type="button" className="rv-link" onClick={onAll}>See all{reviewCount > 8 ? ` ${reviewCount}` : ''}</button>}</div>
    {canRate && <button type="button" className="rv-rate-cta" onClick={onRate}><MessageSquareText size={18} aria-hidden="true" /><span><b>Rate your order</b><small>You ordered here recently — how was it?</small></span><ChevronRight size={18} aria-hidden="true" /></button>}
    {reviews.length ? <div className="rv-rail" role="list">{reviews.map((review) => <div role="listitem" key={review.id}><ReviewCard review={review} compact /></div>)}</div>
      : <p className="sp-note">No reviews yet. {canRate ? 'Be the first!' : 'Reviews appear after customers rate their delivered orders.'}</p>}
  </section>
}


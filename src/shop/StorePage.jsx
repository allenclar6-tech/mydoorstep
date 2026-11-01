import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bike, ChevronRight, Clock3, Heart, Info, MapPin, Minus, Plus, Search, Share2, Store, ThumbsUp, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { BasketBar, EmptyState, Sheet, SkeletonList } from './ShopKit'
import { toast } from './Toaster'
import { CATEGORY_ART } from './Illustrations'
import { freeDeliveryFor } from './ShopHome'
import { addItem, authHeaders, changeItem, etaText, navigate, nairaWhole, ratingPercent, setItemNote, token, useCart, useHome, useStorePage } from './shopData'

export const ORDER_TYPE_KEY = 'doorstep-order-type'
export const readOrderType = () => { try { return localStorage.getItem(ORDER_TYPE_KEY) === 'PICKUP' ? 'PICKUP' : 'DELIVERY' } catch { return 'DELIVERY' } }
export const writeOrderType = (value) => { try { localStorage.setItem(ORDER_TYPE_KEY, value) } catch { /* ignore */ } }

export function FeesInfo({ onClose }) {
  return <Sheet title="Fees information" onClose={onClose}>
    <dl className="sp-fees">
      <div><dt>Delivery fee</dt><dd>Worked out from the road distance between the store and your pin in Sapele. You always see the exact fee before you pay. Pickup orders have no delivery fee.</dd></div>
      <div><dt>Service fee</dt><dd>A small percentage of your items that keeps DOORSTEP running — support, secure payments and order tracking.</dd></div>
      <div><dt>Rider tip</dt><dd>Optional. 100% of your tip goes to the rider who delivers your order.</dd></div>
      <div><dt>Promotions</dt><dd>Promo codes and free-delivery offers are paid for by DOORSTEP. The store is always paid in full.</dd></div>
      <div><dt>Item prices</dt><dd>Set by the store. If something is unavailable, the store will contact you before preparing your order.</dd></div>
    </dl>
  </Sheet>
}

function ReviewsSheet({ store, reviews, onClose }) {
  const percent = ratingPercent(store)
  return <Sheet title="Ratings & reviews" onClose={onClose}>
    <div className="sp-review-summary"><b>{percent != null ? `${percent}%` : '—'}</b><span>{store.ratingCount ? `${Number(store.rating).toFixed(1)} out of 5 from ${store.ratingCount} rating${store.ratingCount === 1 ? '' : 's'}` : 'No ratings yet'}</span></div>
    {reviews.length ? <ul className="sp-review-list">{reviews.map((review) => <li key={review.id}><span className="sp-stars" aria-label={`${review.rating} out of 5`}>{'★'.repeat(review.rating)}<i>{'★'.repeat(5 - review.rating)}</i></span>{review.body && <p>{review.body}</p>}<small>{new Date(review.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</small></li>)}</ul>
      : <p className="sp-note">Reviews appear here after customers rate their delivered orders.</p>}
  </Sheet>
}

function ItemSheet({ item, store, onClose, onAdd }) {
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  return <Sheet title={item.name} onClose={onClose} className="sp-item-sheet">
    {item.image && <img className="sp-item-hero" src={item.image} alt="" />}
    {item.description && <p className="sp-item-desc">{item.description}</p>}
    <label className="sp-field">Note for {store.name} (optional)<textarea rows={2} maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. no pepper, extra sauce" /></label>
    <div className="sp-item-actions">
      <div className="sp-stepper is-big"><button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Fewer"><Minus size={17} /></button><span>{quantity}</span><button type="button" onClick={() => setQuantity(Math.min(50, quantity + 1))} aria-label="More"><Plus size={17} /></button></div>
      <button type="button" className="sp-primary is-wide" onClick={() => onAdd(item, quantity, note)}>Add {quantity} · {nairaWhole(item.price * quantity)}</button>
    </div>
  </Sheet>
}

function ReplaceSheet({ current, store, onCancel, onReplace }) {
  return <Sheet title="Start a new basket?" onClose={onCancel}>
    <p className="sp-note">Your basket has items from <b>{current}</b>. Each order comes from one store, so adding this will clear it.</p>
    <div className="sp-sheet-buttons"><button type="button" className="sp-ghost" onClick={onCancel}>Keep my basket</button><button type="button" className="sp-primary" onClick={onReplace}>New basket from {store.name}</button></div>
  </Sheet>
}

function ItemRow({ item, quantity, onOpen, onPlus, onMinus, compact = false }) {
  return <li className={`sp-item${compact ? ' is-compact' : ''}`} id={`item-${item.id}`}>
    <button type="button" className="sp-item-main" onClick={onOpen}>
      <span className="sp-item-text"><b>{item.name}</b>{item.description && !compact && <small>{item.description}</small>}<strong>{nairaWhole(item.price)}</strong></span>
      {item.image ? <img src={item.image} alt="" loading="lazy" /> : compact ? null : <span className="sp-item-noimg" aria-hidden="true" />}
    </button>
    {quantity ? <div className="sp-stepper"><button type="button" onClick={onMinus} aria-label={`Remove one ${item.name}`}><Minus size={15} /></button><span>{quantity}</span><button type="button" onClick={onPlus} aria-label={`Add one more ${item.name}`}><Plus size={15} /></button></div>
      : <button type="button" className="sp-add" onClick={onPlus} aria-label={`Add ${item.name}`}><Plus size={18} /></button>}
  </li>
}

function useFavorite(storeId) {
  const [favorite, setFavorite] = useState(false)
  useEffect(() => {
    if (!token() || !storeId) return undefined
    let active = true
    fetch(`${apiBase}/api/favorites`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (active && body) setFavorite(body.favorites.some((entry) => entry.restaurantId === storeId && !entry.menuItemId)) }).catch(() => undefined)
    return () => { active = false }
  }, [storeId])
  const toggle = async () => {
    if (!token()) { navigate('/login'); return }
    const next = !favorite
    setFavorite(next)
    const response = await fetch(`${apiBase}/api/favorites`, { method: next ? 'POST' : 'DELETE', headers: authHeaders(), body: JSON.stringify({ restaurantId: storeId }) }).catch(() => null)
    if (!response || (!response.ok && response.status !== 409)) setFavorite(!next)
  }
  return [favorite, toggle]
}

export function StorePage({ slug }) {
  const page = useStorePage(slug)
  const home = useHome()
  const { cart } = useCart()
  const [orderType, setOrderType] = useState(readOrderType)
  const [sheet, setSheet] = useState(null)
  const [pending, setPending] = useState(null)
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState('')
  const sectionRefs = useRef({})
  const store = page.store
  const [favorite, toggleFavorite] = useFavorite(store?.id)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 200)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const sections = useMemo(() => {
    if (!store) return []
    const groups = new Map()
    for (const item of store.items || []) {
      if (query && !`${item.name} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase())) continue
      const key = item.category || 'Menu'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    return [...groups.entries()]
  }, [store, query])
  const topSellers = useMemo(() => store ? page.topSellerIds.map((id) => store.items.find((item) => item.id === id)).filter(Boolean) : [], [store, page.topSellerIds])

  useEffect(() => { if (store && !store.pickupEnabled && orderType === 'PICKUP') setOrderType('DELIVERY') }, [store?.id])
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (store && hash.startsWith('item-')) window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150)
  }, [store?.id])

  if (page.status === 'loading') return <div className="sp-screen"><div className="sp-store-hero is-loading" /><main className="sp-main"><SkeletonList rows={5} /></main></div>
  if (page.status === 'error') return <div className="sp-screen"><header className="sp-header"><button type="button" className="sp-icon-btn" onClick={() => navigate('/')} aria-label="Back"><ArrowLeft size={20} /></button><h1 className="sp-header-title">Store</h1><span className="sp-header-spacer" /></header><main className="sp-main"><EmptyState icon={Store} title="Store unavailable" body={page.error} action={<button type="button" className="sp-primary" onClick={() => navigate('/discover')}>Find another store</button>} /></main></div>

  const quantityOf = (id) => cart.find((entry) => entry.id === id && entry.restaurantId === store.id)?.quantity || 0
  const free = home.data ? freeDeliveryFor(store, home.data) : false
  const percent = ratingPercent(store)
  const add = (item, quantity = 1, note = '', replace = false) => {
    const result = addItem(store, item, { replace })
    if (result === 'OTHER_STORE') { setPending({ item, quantity, note }); return }
    for (let index = 1; index < quantity; index += 1) changeItem(item.id, 1)
    if (note) setItemNote(item.id, note)
    toast(`${quantity > 1 ? `${quantity} × ` : ''}${item.name} added`)
    setSheet(null)
  }
  const chooseType = (value) => { setOrderType(value); writeOrderType(value) }
  const scrollTo = (name) => { setActiveTab(name); sectionRefs.current[name]?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const share = () => { const url = window.location.href.split('#')[0]; if (navigator.share) navigator.share({ title: store.name, url }).catch(() => undefined); else navigator.clipboard?.writeText(url).catch(() => undefined) }

  return <div className="sp-screen sp-store">
    <div className={`sp-store-mini${scrolled ? ' is-on' : ''}`} aria-hidden={!scrolled}>
      <button type="button" className="sp-icon-btn" tabIndex={scrolled ? 0 : -1} onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))} aria-label="Back"><ArrowLeft size={19} /></button>
      <b>{store.name}</b>
      <button type="button" className="sp-icon-btn" tabIndex={scrolled ? 0 : -1} onClick={toggleFavorite} aria-label={favorite ? 'Remove from favourites' : 'Save to favourites'}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /></button>
    </div>
    <div className="sp-store-hero">
      {store.image ? <img src={store.image} alt="" /> : <div className={`sp-store-fallback is-hero is-${store.vertical || 'FOOD'}`} aria-hidden="true">{(() => { const Art = CATEGORY_ART[store.vertical || 'FOOD']; return <span className="sp-fallback-art"><Art /></span> })()}</div>}
      <div className="sp-hero-actions">
        <button type="button" className="sp-round" onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))} aria-label="Back"><ArrowLeft size={19} /></button>
        <span>
          <button type="button" className="sp-round" onClick={share} aria-label="Share store"><Share2 size={17} /></button>
          <button type="button" className={`sp-round${favorite ? ' is-fav' : ''}`} onClick={toggleFavorite} aria-pressed={favorite} aria-label={favorite ? 'Remove from favourites' : 'Save to favourites'}><Heart size={17} /></button>
        </span>
      </div>
    </div>
    <main className="sp-main sp-store-main">
      <section className="sp-store-head">
        <span className="sp-store-logo" aria-hidden="true">{store.logo || store.image ? <img src={store.logo || store.image} alt="" /> : <b>{store.name.slice(0, 1)}</b>}</span>
        <h1>{store.name}</h1>
        <p>{[store.cuisine, store.address].filter(Boolean).join(' · ')}</p>
        {store.pickupEnabled && <div className="sp-mode-toggle" role="radiogroup" aria-label="Delivery or pickup">
          <button type="button" role="radio" aria-checked={orderType === 'DELIVERY'} className={orderType === 'DELIVERY' ? 'is-on' : ''} onClick={() => chooseType('DELIVERY')}><Bike size={15} aria-hidden="true" />Delivery</button>
          <button type="button" role="radio" aria-checked={orderType === 'PICKUP'} className={orderType === 'PICKUP' ? 'is-on' : ''} onClick={() => chooseType('PICKUP')}><Store size={15} aria-hidden="true" />Pickup</button>
        </div>}
        <div className="sp-store-stats">
          <button type="button" onClick={() => setSheet({ kind: 'reviews' })}><ThumbsUp size={15} aria-hidden="true" /><b>{percent != null ? `${percent}%` : 'New'}</b><small>{store.ratingCount ? `${store.ratingCount} rating${store.ratingCount === 1 ? '' : 's'}` : 'No ratings yet'}</small></button>
          <div><Clock3 size={15} aria-hidden="true" /><b>{etaText(orderType === 'PICKUP' ? store.pickupEta : store.eta)}</b><small>{orderType === 'PICKUP' ? 'Ready to collect' : 'Estimated'}</small></div>
          <div>{orderType === 'PICKUP' ? <MapPin size={15} aria-hidden="true" /> : <Bike size={15} aria-hidden="true" />}<b>{orderType === 'PICKUP' ? 'No fee' : free ? <><s>Fee</s> Free</> : 'By distance'}</b><small>{orderType === 'PICKUP' ? 'You collect' : free ? 'First order' : 'Delivery fee'}</small></div>
        </div>
        {!store.openNow && <p className="sp-closed-banner"><Clock3 size={15} aria-hidden="true" />{store.temporarilyClosed ? 'This store has paused orders for now.' : `Closed now${store.openingTime ? ` · opens ${store.openingTime}` : ''}. You can schedule your order at checkout.`}</p>}
        {store.minimumOrderMinor > 0 && <p className="sp-min-order">Minimum order {nairaWhole(store.minimumOrderMinor / 100)}</p>}
        <button type="button" className="sp-fees-link" onClick={() => setSheet({ kind: 'fees' })}><Info size={15} aria-hidden="true" /><span>Fees information</span><ChevronRight size={16} aria-hidden="true" /></button>
      </section>

      {(store.items || []).length === 0 ? <EmptyState icon={Store} title="Menu coming soon" body="This store hasn’t added items yet." /> : <>
        <div className="sp-menu-tools">
          <label className="sp-search-field is-small"><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${store.name}`} aria-label="Search this menu" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear"><X size={14} /></button>}</label>
          {sections.length > 1 && <nav className="sp-menu-tabs" aria-label="Menu sections">{!query && topSellers.length > 0 && <button type="button" className={activeTab === '__top' ? 'is-on' : ''} onClick={() => scrollTo('__top')}>Top sellers</button>}{sections.map(([name]) => <button key={name} type="button" className={activeTab === name ? 'is-on' : ''} onClick={() => scrollTo(name)}>{name}</button>)}</nav>}
        </div>
        {!query && topSellers.length > 0 && <section className="sp-menu-section" ref={(node) => { sectionRefs.current.__top = node }}>
          <h2>Top sellers</h2>
          <ul className="sp-top-sellers">{topSellers.map((item) => <li key={item.id}>
            <button type="button" className="sp-top-card" onClick={() => setSheet({ kind: 'item', item })}>{item.image ? <img src={item.image} alt="" loading="lazy" /> : <span className="sp-item-noimg" aria-hidden="true" />}<b>{item.name}</b><strong>{nairaWhole(item.price)}</strong></button>
            <button type="button" className="sp-add is-floating" onClick={() => add(item)} aria-label={`Add ${item.name}`}>{quantityOf(item.id) ? quantityOf(item.id) : <Plus size={17} />}</button>
          </li>)}</ul>
        </section>}
        {sections.map(([name, items]) => <section key={name} className="sp-menu-section" ref={(node) => { sectionRefs.current[name] = node }}>
          <h2>{name}</h2>
          <ul className="sp-items">{items.map((item) => <ItemRow key={item.id} item={item} quantity={quantityOf(item.id)} onOpen={() => setSheet({ kind: 'item', item })} onPlus={() => (quantityOf(item.id) ? changeItem(item.id, 1) : add(item))} onMinus={() => changeItem(item.id, -1)} />)}</ul>
        </section>)}
        {query && sections.length === 0 && <EmptyState icon={Search} title="No items match" body={`Nothing called “${query}” here.`} />}
      </>}
    </main>
    <BasketBar />
    {sheet?.kind === 'fees' && <FeesInfo onClose={() => setSheet(null)} />}
    {sheet?.kind === 'reviews' && <ReviewsSheet store={store} reviews={page.reviews} onClose={() => setSheet(null)} />}
    {sheet?.kind === 'item' && <ItemSheet item={sheet.item} store={store} onClose={() => setSheet(null)} onAdd={add} />}
    {pending && <ReplaceSheet current={cart[0]?.restaurantName} store={store} onCancel={() => setPending(null)} onReplace={() => { const next = pending; setPending(null); add(next.item, next.quantity, next.note, true) }} />}
  </div>
}

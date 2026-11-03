import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Ban, Bell, Bike, ChevronDown, ChevronRight, Clock3, Heart, Home, LocateFixed, MapPin, Pencil, Plus, ReceiptText, Search, ShoppingBag, ThumbsUp, User, X } from 'lucide-react'
import { CATEGORY_ART } from './Illustrations'
import { chooseAddress, etaText, navigate, ratingPercent, storeHref, token, useAddress, useCart, useDeliveryCheck, useSavedAddresses, VERTICALS } from './shopData'

// Building blocks shared by every customer screen.

export const CATEGORY_TILES = [
  { key: 'FOOD', label: 'Food', href: VERTICALS.FOOD.path, tone: 'sun' },
  { key: 'GROCERIES', label: 'Groceries', href: VERTICALS.GROCERIES.path, tone: 'mint' },
  { key: 'SHOPS', label: 'Shops', href: VERTICALS.SHOPS.path, tone: 'sky' },
  { key: 'PHARMACY_BEAUTY', label: 'Pharmacy & Beauty', href: VERTICALS.PHARMACY_BEAUTY.path, tone: 'rose' },
  { key: 'PACKAGE', label: 'Package Delivery', href: '/send', tone: 'sand' },
  { key: 'OFFERS', label: 'Offers', href: '/account/promos', tone: 'sun' },
]

const link = (href) => (event) => { event.preventDefault(); navigate(href) }

export function Sheet({ title, onClose, children, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous }
  }, [onClose])
  return createPortal(<div className="sp-sheet-layer" role="dialog" aria-modal="true" aria-label={title}>
    <button type="button" className="sp-sheet-backdrop" aria-label="Close" onClick={onClose} />
    <section className={`sp-sheet ${className}`} ref={ref} tabIndex={-1}>
      <span className="sp-sheet-grip" aria-hidden="true" />
      <header><strong>{title}</strong><button type="button" className="sp-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <div className="sp-sheet-body">{children}</div>
    </section>
  </div>, document.body)
}

/** “Delivering to …” button for the yellow band; opens the address sheet. */
export function AddressPill({ compact = false }) {
  const address = useAddress()
  const [open, setOpen] = useState(false)
  const check = useDeliveryCheck(address)
  const out = check && !check.deliverable
  if (compact) return <>
    <button type="button" className={`sp-address-chip${out ? ' is-out' : ''}`} onClick={() => setOpen(true)} aria-label={`Delivery address: ${address.label || 'not set'}. Change`}>
      <Home size={19} aria-hidden="true" /><span>{address.label || 'Set your address'}</span><ChevronDown size={19} aria-hidden="true" />
    </button>
    {open && <AddressSheet onClose={() => setOpen(false)} />}
  </>
  return <>
    <button type="button" className={`sp-address${out ? ' is-out' : ''}`} onClick={() => setOpen(true)} aria-label={`Delivery address: ${address.label || 'not set'}. Change`}>
      <MapPin size={18} aria-hidden="true" />
      <span><small>{out ? 'Outside our delivery area' : address.label ? 'Delivering to' : 'Where should we deliver?'}</small><strong>{address.label || 'Set your address'}</strong></span>
      <ChevronDown size={18} aria-hidden="true" />
    </button>
    {open && <AddressSheet onClose={() => setOpen(false)} />}
  </>
}

export function AddressSheet({ onClose }) {
  const address = useAddress()
  const saved = useSavedAddresses()
  const check = useDeliveryCheck(address)
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState('')
  const here = window.location.pathname
  const locate = () => {
    if (!navigator.geolocation) { setMessage('This device can’t share its location. Pick your spot on the map instead.'); return }
    setLocating(true); setMessage('')
    navigator.geolocation.getCurrentPosition((position) => {
      setLocating(false)
      chooseAddress({ label: 'Current location', latitude: position.coords.latitude, longitude: position.coords.longitude })
    }, () => { setLocating(false); setMessage('Location permission was refused. Pick your spot on the map instead.') }, { enableHighAccuracy: true, timeout: 12_000 })
  }
  return <Sheet title="Where should we deliver?" onClose={onClose} className="sp-address-sheet">
    <div className={`sp-current-address${check && !check.deliverable ? ' is-out' : ''}`}>
      <span className="sp-pin-dot" aria-hidden="true">{check && !check.deliverable ? <Ban size={18} /> : <MapPin size={18} />}</span>
      <div><strong>{address.label || 'No address yet'}</strong><small>{check ? check.message : address.point ? 'Checking this spot…' : address.label ? 'Priced by your area. Add a pin for the exact fee.' : 'Type your address or pick it on the map.'}</small></div>
    </div>
    <div className="sp-address-actions">
      <button type="button" className="sp-row-btn" onClick={() => { onClose(); navigate(`/address/new?return=${encodeURIComponent(here)}`) }}><Pencil size={18} aria-hidden="true" /><span>Type an address</span><ChevronRight size={16} aria-hidden="true" /></button>
      <button type="button" className="sp-row-btn" onClick={locate} disabled={locating}><LocateFixed size={18} aria-hidden="true" /><span>{locating ? 'Finding you…' : 'Use my current location'}</span><ChevronRight size={16} aria-hidden="true" /></button>
      <button type="button" className="sp-row-btn" onClick={() => { onClose(); navigate(`/location?return=${encodeURIComponent(here)}`) }}><MapPin size={18} aria-hidden="true" /><span>{address.point ? 'Move my pin on the map' : 'Pick my spot on the map'}</span><ChevronRight size={16} aria-hidden="true" /></button>
    </div>
    {message && <p className="sp-note" role="status">{message}</p>}
    {saved.length > 0 && <>
      <h3 className="sp-sheet-sub">Saved addresses</h3>
      <ul className="sp-saved-list">{saved.map((entry) => {
        const lat = Number(entry.latitude); const lng = Number(entry.longitude)
        const selected = address.savedAddressId === entry.id
        return <li key={entry.id}><button type="button" className={selected ? 'is-selected' : ''} onClick={() => { chooseAddress({ label: entry.addressLine, latitude: entry.latitude == null ? NaN : lat, longitude: entry.longitude == null ? NaN : lng, savedAddressId: entry.id, landmark: entry.landmark || null }); onClose() }}>
          <Home size={17} aria-hidden="true" /><span><b>{entry.label}</b><small>{entry.addressLine}{entry.landmark ? ` · ${entry.landmark}` : ''}</small>{entry.latitude == null && <small className="sp-saved-nopin">No pin · priced by area</small>}</span>{selected && <span className="sp-check" aria-label="Selected">✓</span>}
        </button></li>
      })}</ul>
    </>}
    <div className="sp-sheet-links"><button type="button" className="sp-add-address" onClick={() => { onClose(); navigate(`/address/new?return=${encodeURIComponent(here)}`) }}><Plus size={17} aria-hidden="true" />Add a new address</button>{token() && saved.length > 0 && <button type="button" className="sp-text-link" onClick={() => { onClose(); navigate('/account/addresses') }}>Manage addresses</button>}</div>
  </Sheet>
}

/** Shown in place of stores when the chosen address is outside DOORSTEP's delivery area. */
export function OutOfArea({ check }) {
  const [open, setOpen] = useState(false)
  return <section className="sp-out-of-area" aria-live="polite">
    <div className="sp-out-art" aria-hidden="true"><MapPin size={34} /><span><Ban size={20} /></span></div>
    <h2>Out of delivery area</h2>
    <p>{check?.message || 'DOORSTEP doesn’t deliver to this address yet.'} We’re growing across Delta, Edo and Rivers — try another address, or pick up from a store yourself.</p>
    <button type="button" className="sp-primary" onClick={() => setOpen(true)}>Change address</button>
    <button type="button" className="sp-ghost" onClick={() => navigate('/discover?pickup=1')}>See stores for pickup</button>
    {open && <AddressSheet onClose={() => setOpen(false)} />}
  </section>
}

/** DOORSTEP pin logo, as in the site header. */
export function Logo({ text }) {
  return <a className={`sp-logo${text ? ' has-greeting' : ''}`} href="/" onClick={link('/')} aria-label="DOORSTEP home"><span className="sp-logo-mark" aria-hidden="true" /><span className="sp-logo-word">{text || 'DOORSTEP'}</span></a>
}

export function BellButton() {
  if (!token()) return null
  return <a className="sp-band-btn" href="/account/notifications" onClick={link('/account/notifications')} aria-label="Notifications"><Bell size={19} /></a>
}

export function CartButton({ hideEmpty = false }) {
  const { count } = useCart()
  if (hideEmpty && !count) return null
  return <a className="sp-band-btn" href="/checkout" onClick={link('/checkout')} aria-label={`Basket, ${count} item${count === 1 ? '' : 's'}`}><ShoppingBag size={19} />{count > 0 && <b>{count}</b>}</a>
}
const goBack = (fallback) => () => (window.history.length > 1 ? window.history.back() : navigate(fallback))

/**
 * Yellow top band (the DOORSTEP marketplace header). Home shows the logo and address; inner screens show a back
 * button and a title. A search box can sit inside the band.
 */
export function Band({ title, back, search, children, brandText }) {
  return <header className="sp-band">
    <div className="sp-band-row">
      {back ? <button type="button" className="sp-band-btn" onClick={goBack(back)} aria-label="Back"><ArrowLeft size={20} /></button> : !title && <Logo text={brandText} />}
      {title && <h1 className={`sp-band-title${back ? '' : ' is-big'}`}>{title}</h1>}
      <div className="sp-band-actions">
        {!back && token() && <a className="sp-band-btn" href="/account/notifications" onClick={link('/account/notifications')} aria-label="Notifications"><Bell size={19} /></a>}
        <CartButton />
      </div>
    </div>
    {children}
    {search}
  </header>
}

/** Search field for the band. With `href`, it is a button that opens Discover. */
export function BandSearch({ value, onChange, placeholder, href, autoFocus }) {
  if (href) return <a className="sp-search" href={href} onClick={link(href)}><Search size={18} aria-hidden="true" /><span>{placeholder}</span></a>
  return <label className="sp-search"><Search size={18} aria-hidden="true" /><input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} enterKeyHint="search" />{value && <button type="button" onClick={() => onChange('')} aria-label="Clear search"><X size={15} /></button>}</label>
}

/** Plain white header for inner screens (checkout, promo codes, FAQ). */
export function ShopHeader({ title, back = '/' }) {
  return <header className="sp-header">
    <button type="button" className="sp-icon-btn" onClick={goBack(back)} aria-label="Back"><ArrowLeft size={20} /></button>
    <h1 className="sp-header-title">{title}</h1>
    <span className="sp-header-spacer" />
  </header>
}

/** Round illustrated category button. */
export function Bubble({ art: Art, label, href, tone = 'mint', active, onClick, size = 'md' }) {
  const body = <><span className={`sp-bubble-art is-${tone}`} aria-hidden="true">{Art && <Art />}</span><span className="sp-bubble-label">{label}</span></>
  if (href) return <a className={`sp-bubble is-${size}`} href={href} onClick={link(href)}>{body}</a>
  return <button type="button" className={`sp-bubble is-${size}${active ? ' is-active' : ''}`} aria-pressed={active} onClick={onClick}>{body}</button>
}
export const categoryArt = (key) => CATEGORY_ART[key]

export function TabBar({ active }) {
  const items = [
    ['home', 'Home', '/', Home],
    ['discover', 'Discover', '/discover', Search],
    ['orders', 'Orders', '/account/orders', ReceiptText],
    ['profile', 'Profile', '/profile', User],
  ]
  return <nav className="sp-tabbar" aria-label="Main">{items.map(([key, label, href, Icon]) => <a key={key} href={href} onClick={link(href)} className={active === key ? 'is-active' : undefined} aria-current={active === key ? 'page' : undefined}><span className="sp-tab-icon"><Icon size={21} aria-hidden="true" /></span><span>{label}</span></a>)}</nav>
}

/** Sticky basket bar at the bottom of store screens. */
export function BasketBar() {
  const { cart, count, subtotal } = useCart()
  if (!count) return null
  return <a className="sp-basket-bar" href="/checkout" onClick={link('/checkout')}>
    <span className="sp-basket-count" key={count}>{count}</span>
    <span className="sp-basket-text"><b>View basket</b><small>{cart[0]?.restaurantName}</small></span>
    <span className="sp-basket-total">₦{Math.round(subtotal).toLocaleString('en-NG')}</span>
  </a>
}

export function SectionHead({ title, href, hint }) {
  return <div className="sp-section-head">
    <div><h2>{title}</h2>{hint && <small>{hint}</small>}</div>
    {href && <a href={href} onClick={link(href)} className="sp-see-all">See all <ChevronRight size={15} aria-hidden="true" /></a>}
  </div>
}

function StoreImage({ store }) {
  const [failed, setFailed] = useState(false)
  if (!store.image || failed) { const Art = CATEGORY_ART[store.vertical] || CATEGORY_ART.FOOD; return <div className={`sp-store-fallback is-${store.vertical || 'FOOD'}`} aria-hidden="true"><span className="sp-fallback-art"><Art /></span><b>{store.name}</b></div> }
  return <img src={store.image} alt="" loading="lazy" onError={() => setFailed(true)} />
}

export function StoreFacts({ store, freeDelivery }) {
  const percent = ratingPercent(store)
  return <div className="sp-store-facts">
    {percent != null ? <span className="sp-rating"><ThumbsUp size={13} aria-hidden="true" />{percent}%<small> ({store.ratingCount})</small></span> : <span className="sp-new">New</span>}
    <span className={freeDelivery ? 'sp-fee is-free' : 'sp-fee'}><Bike size={14} aria-hidden="true" />{freeDelivery ? 'Free delivery' : 'By distance'}</span>
    <span><Clock3 size={13} aria-hidden="true" />{etaText(store.eta)}</span>
  </div>
}

function MediaTags({ store, freeDelivery, badge }) {
  if (!store.openNow) return <span className="sp-closed-tag">{store.temporarilyClosed ? 'Paused' : store.openingTime ? `Opens ${store.openingTime}` : 'Closed'}</span>
  return <>{badge && <span className="sp-rank-tag">{badge}</span>}{freeDelivery && <span className="sp-promo-tag">Free delivery</span>}</>
}

/** Full-width store card used in lists. */
export function StoreCard({ store, freeDelivery, badge }) {
  return <a className={`sp-store-card${store.openNow ? '' : ' is-closed'}`} href={storeHref(store)} onClick={link(storeHref(store))}>
    <div className="sp-store-media"><StoreImage store={store} /><MediaTags store={store} freeDelivery={freeDelivery} badge={badge} /></div>
    <div className="sp-store-info">
      <div className="sp-store-title"><h3>{store.name}</h3>{store.pickupEnabled && <span className="sp-pickup-chip">Pickup</span>}</div>
      <StoreFacts store={store} freeDelivery={freeDelivery} />
    </div>
  </a>
}

/** Compact card for horizontal rails. */
export function StoreTile({ store, freeDelivery, badge }) {
  return <a className={`sp-store-tile${store.openNow ? '' : ' is-closed'}`} href={storeHref(store)} onClick={link(storeHref(store))}>
    <div className="sp-store-media"><StoreImage store={store} /><MediaTags store={store} freeDelivery={freeDelivery} badge={badge} /></div>
    <h3>{store.name}</h3>
    <StoreFacts store={store} freeDelivery={freeDelivery} />
  </a>
}

/** “Popular brands”: round store logos. */
export function BrandCircles({ stores }) {
  return <div className="sp-brands" role="list">{stores.map((store) => <a key={store.id} role="listitem" className="sp-brand" href={storeHref(store)} onClick={link(storeHref(store))}>
    <span className="sp-brand-logo">{store.logo || store.image ? <img src={store.logo || store.image} alt="" loading="lazy" /> : <b>{store.name.slice(0, 1)}</b>}</span>
    <span className="sp-brand-name">{store.name}</span>
    {store.eta && <small>{store.eta[0]}–{store.eta[1]} min</small>}
  </a>)}</div>
}

export function Rail({ children, label }) {
  return <div className="sp-rail" role="list" aria-label={label}>{children}</div>
}

export function EmptyState({ icon: Icon = Heart, title, body, action }) {
  return <div className="sp-empty"><span aria-hidden="true"><Icon size={26} /></span><h3>{title}</h3>{body && <p>{body}</p>}{action}</div>
}

export function SkeletonList({ rows = 3 }) {
  return <div className="sp-skeletons" aria-label="Loading" role="status">{Array.from({ length: rows }, (_, index) => <div key={index} className="sp-skeleton" />)}</div>
}

// Desktop only (hidden on phones by CSS) -------------------------------------------------------------------------------
const DESKTOP_LINKS = [['Food', '/food'], ['Groceries', '/groceries'], ['Shops', '/shops'], ['Pharmacy', '/pharmacy']]

function DesktopSearch() {
  const [value, setValue] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const submit = (event) => { event.preventDefault(); const query = value.trim(); navigate(query ? `/discover?q=${encodeURIComponent(query)}` : '/discover') }
  return <form className="sp-dnav-search" role="search" onSubmit={submit}><Search size={17} aria-hidden="true" /><input type="search" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Search DOORSTEP" aria-label="Search food, stores or items" /></form>
}

/** Top navigation for computers: logo, sections, address, search, basket and account. */
export function DesktopNav() {
  const path = window.location.pathname
  const { count } = useCart()
  const signedIn = Boolean(token())
  return <header className="sp-dnav">
    <div className="sp-dnav-inner">
      <Logo />
      <nav aria-label="Sections">{DESKTOP_LINKS.map(([label, href]) => <a key={href} href={href} onClick={link(href)} className={path === href ? 'is-active' : undefined}>{label}</a>)}</nav>
      <div className="sp-dnav-right">
        <AddressPill />
        <DesktopSearch />
        <a className="sp-dnav-cart" href="/checkout" onClick={link('/checkout')} aria-label={`Basket, ${count} item${count === 1 ? '' : 's'}`}><ShoppingBag size={18} aria-hidden="true" /><span>Basket</span>{count > 0 && <b>{count}</b>}</a>
        {signedIn && <a className="sp-dnav-cart" href="/account/orders" onClick={link('/account/orders')} aria-label="Your orders"><ReceiptText size={18} aria-hidden="true" /><span>Orders</span></a>}
        <a className="sp-dnav-account" href={signedIn ? '/profile' : '/login'} onClick={link(signedIn ? '/profile' : '/login')}><User size={18} aria-hidden="true" /><span>{signedIn ? 'Account' : 'Sign in'}</span></a>
      </div>
    </div>
  </header>
}

/** Footer for computers. */
export function DesktopFooter() {
  const columns = [
    ['Order', [['Food', '/food'], ['Groceries', '/groceries'], ['Shops', '/shops'], ['Pharmacy & Beauty', '/pharmacy'], ['Send a package', '/send']]],
    ['Partners', [['Sell on DOORSTEP', '/partner/register'], ['Ride with DOORSTEP', '/riders'], ['Partner sign in', '/partner/login'], ['Rider sign in', '/rider/login']]],
    ['Get the app', [['Android app', '/download'], ['Install on iPhone', '/download']]],
    ['Help', [['FAQ', '/help/faq'], ['Track an order', '/track-order'], ['Contact us', '/contact'], ['Refund policy', '/refund-policy']]],
    ['Legal', [['Terms', '/terms'], ['Privacy', '/privacy'], ['Delivery policy', '/delivery-policy']]],
  ]
  return <footer className="sp-dfoot">
    <div className="sp-dfoot-inner">
      <div className="sp-dfoot-brand"><Logo /><p>Food, groceries and everyday essentials from shops and kitchens across Delta, Edo and Rivers, delivered by local riders.</p></div>
      {columns.map(([title, links]) => <nav key={title} aria-label={title}><b>{title}</b>{links.map(([label, href]) => <a key={href} href={href} onClick={link(href)}>{label}</a>)}</nav>)}
    </div>
    <small className="sp-dfoot-legal">© {new Date().getFullYear()} DOORSTEP · Nigeria</small>
  </footer>
}

/** Basket panel shown beside a store's menu on computers. */
export function DesktopBasket() {
  const { cart, count, subtotal } = useCart()
  return <aside className="sp-dbasket" aria-label="Your basket">
    <h2>Your basket</h2>
    {count === 0 ? <p className="sp-note">Add items from the menu and they’ll appear here.</p> : <>
      <small className="sp-dbasket-store">{cart[0].restaurantName}</small>
      <ul>{cart.map((item) => <li key={item.key || item.id}><span className="sp-dbasket-qty">{item.quantity}×</span><span>{item.name}{item.options?.length > 0 && <small className="sp-basket-choices">{item.options.map((option) => option.name).join(', ')}</small>}</span><b>₦{Math.round(item.price * item.quantity).toLocaleString('en-NG')}</b></li>)}</ul>
      <div className="sp-dbasket-total"><span>Products</span><b>₦{Math.round(subtotal).toLocaleString('en-NG')}</b></div>
      <a className="sp-primary is-wide" href="/checkout" onClick={link('/checkout')}>Go to checkout</a>
      <small className="sp-note">Delivery and service fees are shown at checkout.</small>
    </>}
  </aside>
}

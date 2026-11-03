import { useEffect, useRef, useState } from 'react'
import { Bike, ChefHat, ChevronRight, PackageCheck, Store as StoreIcon } from 'lucide-react'
import { ORDER_STATUS_LABELS } from '../orders/OrderActions'
import { AddressSheet, Band, BandSearch, BellButton, Bubble, CartButton, Logo, CATEGORY_TILES, categoryArt, EmptyState, OutOfArea, Rail, SectionHead, SkeletonList, StoreTile, TabBar, AddressPill } from './ShopKit'
import { Parcel, PercentTag, ShoppingBag as BagArt, Burger, Basket } from './Illustrations'
import { PushPrompt } from '../notifications/PushPrompt'
import { InstallApp } from '../app/InstallApp'
import { ACTIVE_ORDER_STATUSES, greeting, navigate, storeHref, token, useAddress, useDeliveryCheck, useHome, useMe, useMyOrders } from './shopData'

const link = (href) => (event) => { event.preventDefault(); navigate(href) }

/** Does an automatic free-delivery offer cover this store for this customer? */
export function freeDeliveryFor(store, home) {
  const offer = home?.firstOrder?.offer
  if (!offer || offer.type !== 'FREE_DELIVERY' || home.firstOrder.eligible === false) return false
  if (offer.restaurantId && offer.restaurantId !== store.id) return false
  if (offer.vertical && offer.vertical !== store.vertical) return false
  return true
}

export const pick = (home, ids) => ids.map((id) => home.stores.find((store) => store.id === id)).filter(Boolean)

/** Swipeable promo banners (one per live offer), with dots. */
export function PromoBanners({ offers, signedIn }) {
  const ref = useRef(null)
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const onScroll = () => setIndex(Math.round(node.scrollLeft / Math.max(1, node.clientWidth)))
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])
  if (!offers.length) return null
  const art = (offer) => offer.type === 'FREE_DELIVERY' ? Parcel : offer.vertical === 'GROCERIES' ? Basket : offer.vertical === 'SHOPS' ? BagArt : offer.type === 'PERCENT' ? PercentTag : Burger
  return <section className="sp-banners" aria-label="Offers">
    <div className="sp-banner-track" ref={ref}>{offers.map((offer, position) => {
      const Art = art(offer)
      const href = offer.firstOrderOnly && !signedIn ? '/register' : '/account/promos'
      return <a key={offer.id} className={`sp-banner is-${position % 3}`} href={href} onClick={link(href)}>
        <span className="sp-banner-copy">
          <small>{offer.firstOrderOnly ? 'New on DOORSTEP' : offer.autoApply ? 'Applied at checkout' : 'Promo code'}</small>
          <b>{offer.type === 'FREE_DELIVERY' && offer.firstOrderOnly ? 'Your first delivery is free' : offer.label}</b>
          <span>{offer.code ? <em>Use code {offer.code}</em> : offer.description || offer.name}</span>
        </span>
        <span className="sp-banner-art" aria-hidden="true"><Art /></span>
      </a>
    })}</div>
    {offers.length > 1 && <div className="sp-dots" aria-hidden="true">{offers.map((offer, position) => <span key={offer.id} className={position === index ? 'is-on' : ''} />)}</div>}
  </section>
}


const STEPS = [['PAID', 'Sent'], ['PREPARING', 'Preparing'], ['OUT_FOR_DELIVERY', 'On the way'], ['DELIVERED', 'Arrived']]
const stepOf = (status) => ({ PAID: 0, RESTAURANT_ACCEPTED: 1, PREPARING: 1, READY_FOR_PICKUP: 1, RIDER_ASSIGNED: 2, PICKED_UP: 2, OUT_FOR_DELIVERY: 2, DELIVERED: 3 }[status] ?? 0)

/** Live card for an order in progress: status, a four-step progress bar and a tap to track. */
export function LiveOrderBanner({ order }) {
  const step = stepOf(order.status)
  const pickup = order.orderType === 'PICKUP'
  const Icon = order.status === 'PREPARING' || order.status === 'RESTAURANT_ACCEPTED' ? ChefHat : ['PICKED_UP', 'OUT_FOR_DELIVERY', 'RIDER_ASSIGNED'].includes(order.status) ? Bike : order.status === 'READY_FOR_PICKUP' ? PackageCheck : StoreIcon
  const href = `/account/orders/${order.id}`
  return <a className="sp-live" href={href} onClick={link(href)}>
    <span className="sp-live-icon" aria-hidden="true"><Icon size={22} /></span>
    <span className="sp-live-text"><small>{order.restaurant?.name || 'Your order'}</small><b>{pickup && order.status === 'READY_FOR_PICKUP' ? 'Ready to collect' : ORDER_STATUS_LABELS[order.status] || 'In progress'}</b>
      <span className="sp-live-bar" aria-label={`Step ${step + 1} of 4`}>{STEPS.map(([key, label], index) => <i key={key} className={index <= step ? 'is-on' : ''} title={label} />)}</span>
    </span>
    <span className="sp-live-go">Track<ChevronRight size={16} aria-hidden="true" /></span>
  </a>
}

/** A store (or the Promotions shortcut) as a square tile with its name underneath. */
function SquareTile({ href, label, image, art: Art }) {
  const [failed, setFailed] = useState(false)
  return <a className="sp-sq" href={href} onClick={link(href)} role="listitem">
    <span className="sp-sq-box" aria-hidden="true">{image && !failed ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} /> : Art ? <span className="sp-sq-art"><Art /></span> : <b>{label.slice(0, 1)}</b>}</span>
    <span className="sp-sq-name">{label}</span>
  </a>
}

/** Rows of four square tiles that swipe page by page, with dots underneath. */
function TilePages({ label, children }) {
  const ref = useRef(null)
  const [page, setPage] = useState(0)
  const count = Math.ceil(children.length / 4)
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const onScroll = () => setPage(Math.round(node.scrollLeft / Math.max(1, node.clientWidth)))
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])
  return <>
    <div className="sp-sq-track" ref={ref} role="list" aria-label={label}>{children}</div>
    {count > 1 && <div className="sp-dots" aria-hidden="true">{Array.from({ length: count }, (_, index) => <span key={index} className={index === page ? 'is-on' : ''} />)}</div>}
  </>
}

/** One clear offer card, like “Enjoy free delivery on your first order”. */
function OfferCard({ offer, signedIn }) {
  if (!offer) return null
  const href = offer.firstOrderOnly && !signedIn ? '/register' : '/account/promos'
  const Art = offer.type === 'FREE_DELIVERY' ? Parcel : PercentTag
  const title = offer.type === 'FREE_DELIVERY' && offer.firstOrderOnly ? 'Enjoy free delivery on your first order' : offer.label
  return <a className="sp-offer-card" href={href} onClick={link(href)}>
    <span className="sp-offer-copy"><b>{title}</b><small>{offer.code ? `Use code ${offer.code} at checkout.` : offer.autoApply ? 'Offer applied automatically.' : offer.description || offer.name}</small></span>
    <span className="sp-offer-art" aria-hidden="true"><Art /></span>
    <span className="sp-offer-go" aria-hidden="true"><ChevronRight size={18} /></span>
  </a>
}

const BIG_CATEGORIES = CATEGORY_TILES.filter((tile) => tile.key !== 'OFFERS')

const ASKED_KEY = 'doorstep-asked-address'
const askedBefore = () => { try { return Boolean(localStorage.getItem(ASKED_KEY)) } catch { return true } }

/** Grey shapes in the same layout as the real home while stores load (like Glovo), instead of a spinner. */
function HomeSkeleton() {
  return <div className="sp-home-skeleton" role="status" aria-label="Loading stores">
    <div className="sp-m-only">
      <span className="hs-line is-title" />
      <div className="hs-tiles">{[0, 1, 2, 3].map((index) => <span key={index}><i /><b /></span>)}</div>
      <span className="hs-card" />
    </div>
    <div className="sp-d-only"><SkeletonList rows={2} /></div>
  </div>
}

export function ShopHome() {
  const home = useHome()
  const address = useAddress()
  const check = useDeliveryCheck(address)
  // First open with no address yet: ask where to deliver straight away (Glovo does the same). Only once per device.
  const [askAddress, setAskAddress] = useState(() => !address.label && !askedBefore())
  const closeAsk = () => { try { localStorage.setItem(ASKED_KEY, String(Date.now())) } catch { /* private mode */ } setAskAddress(false) }
  const data = home.data
  const signedIn = Boolean(token())
  const open = data ? data.stores.filter((store) => store.openNow) : []
  const forYou = data ? (() => { const ids = [...new Set([...data.sections.topRated, ...data.sections.mostInDemand, ...data.sections.topPerformers])]; const picked = pick(data, ids).filter((store) => store.openNow); return (picked.length >= 3 ? picked : open).slice(0, 10) })() : []
  const outside = check && check.deliverable === false
  const me = useMe()
  const orders = useMyOrders()
  const live = orders.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status)).slice(0, 2)
  const again = data ? [...new Set(orders.filter((order) => order.status === 'DELIVERED').map((order) => order.restaurantId))].map((id) => data.stores.find((store) => store.id === id)).filter(Boolean).slice(0, 10) : []
  const name = me?.preferredName || me?.firstName
  const offer = data ? data.offers.find((entry) => entry.type === 'FREE_DELIVERY' && entry.firstOrderOnly && data.firstOrder?.eligible !== false) || data.offers[0] : null

  return <div className="sp-screen sp-home">
    {/* Phone: simple yellow top with the address and big category circles. */}
    <header className="sp-mtop sp-m-only">
      <div className="sp-mtop-head">
        <Logo text={signedIn ? `${greeting()}${name ? `, ${name}` : ''} 👋` : undefined} />
        <div className="sp-band-actions"><BellButton /><CartButton /></div>
      </div>
      <div className="sp-mtop-address"><AddressPill compact /></div>
      <nav className="sp-mcats" aria-label="What do you need?">{BIG_CATEGORIES.map((tile) => { const Art = categoryArt(tile.key); return <a key={tile.key} className="sp-mcat" href={tile.href} onClick={link(tile.href)}>
        <span className="sp-mcat-circle" aria-hidden="true"><span className="sp-mcat-art"><Art /></span></span>
        <span className="sp-mcat-label">{tile.label}</span>
      </a> })}</nav>
      <svg className="sp-mtop-wave" viewBox="0 0 390 48" preserveAspectRatio="none" aria-hidden="true"><path d="M0 22 C 90 2, 170 4, 250 16 S 360 30, 390 12 V48 H0 Z" fill="currentColor" opacity=".35" /><path d="M0 32 C 80 14, 180 14, 260 26 S 360 36, 390 24 V48 H0 Z" fill="currentColor" /></svg>
    </header>

    {/* Desktop: the wide hero with search. */}
    <div className="sp-d-only">
      <Band search={<BandSearch href="/discover" placeholder="What can we get you?" />}>
        <div className="sp-hero-desk">
          <h1>{signedIn ? `${greeting()}${name ? `, ${name}` : ''}!` : 'Food, groceries and more,'}<br /><em>{signedIn ? 'What can we get you today?' : 'delivered near you.'}</em></h1>
          <div className="sp-hero-art" aria-hidden="true"><span><Burger /></span><span><Basket /></span><span><BagArt /></span><span><Parcel /></span></div>
        </div>
        <AddressPill />
      </Band>
    </div>

    <main className="sp-body">
      {live.map((order) => <LiveOrderBanner key={order.id} order={order} />)}
      <nav className="sp-bubbles sp-d-only" aria-label="Categories">{CATEGORY_TILES.map((tile) => <Bubble key={tile.key} art={categoryArt(tile.key)} label={tile.label} href={tile.href} tone={tile.tone} size="lg" />)}</nav>

      {outside ? <OutOfArea check={check} /> : <>
        {home.status === 'loading' && <HomeSkeleton />}
        {home.status === 'error' && <EmptyState title="Couldn’t load stores" body={home.error} action={<button type="button" className="sp-primary" onClick={home.reload}>Try again</button>} />}
        {data && <>
          {/* Phone layout */}
          <div className="sp-m-only">
            <section className="sp-section">
              <h2 className="sp-mtitle">{name ? `${name}, these are for you` : 'These are for you'}</h2>
              <TilePages label="Picked for you">
                {forYou.map((store) => <SquareTile key={store.id} href={storeHref(store)} label={store.name} image={store.logo || store.image} art={categoryArt(store.vertical)} />)}
                {data.offers.length > 0 && <SquareTile href="/account/promos" label="Promotions" art={PercentTag} />}
              </TilePages>
            </section>
            <OfferCard offer={offer} signedIn={signedIn} />
            {again.length > 0 && <section className="sp-section">
              <h2 className="sp-mtitle">Order again</h2>
              <TilePages label="Order again">{again.map((store) => <SquareTile key={store.id} href={storeHref(store)} label={store.name} image={store.logo || store.image} art={categoryArt(store.vertical)} />)}</TilePages>
            </section>}
            <InstallApp who="customer" />
            {signedIn && <PushPrompt who="customer" />}
          </div>

          {/* Desktop layout */}
          <div className="sp-d-only">
            <PromoBanners offers={data.offers} signedIn={signedIn} />
            {forYou.length > 0 ? <section className="sp-section">
              <SectionHead title="These are for you" href="/discover" />
              <Rail label="Picked for you">{forYou.map((store) => <StoreTile key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail>
            </section> : <EmptyState title="No stores open right now" body="Kitchens and shops open through the day. You can still schedule an order from a store page." action={<button type="button" className="sp-primary" onClick={() => navigate('/discover')}>Browse all stores</button>} />}
            {again.length > 0 && <section className="sp-section">
              <SectionHead title="Order again" href="/account/orders" />
              <Rail label="Order again">{again.map((store) => <StoreTile key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail>
            </section>}
          </div>
        </>}
      </>}
    </main>
    {askAddress && <AddressSheet onClose={closeAsk} />}
    <TabBar active="home" />
  </div>
}

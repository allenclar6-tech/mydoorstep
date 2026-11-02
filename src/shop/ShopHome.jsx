import { useEffect, useRef, useState } from 'react'
import { Bike, ChefHat, ChevronRight, PackageCheck, Store as StoreIcon } from 'lucide-react'
import { ORDER_STATUS_LABELS } from '../orders/OrderActions'
import { Band, BandSearch, BrandCircles, Bubble, CATEGORY_TILES, categoryArt, EmptyState, OutOfArea, Rail, SectionHead, SkeletonList, StoreTile, TabBar, AddressPill } from './ShopKit'
import { Parcel, PercentTag, ShoppingBag as BagArt, Burger, Basket, Scooter, Storefront } from './Illustrations'
import { ACTIVE_ORDER_STATUSES, greeting, navigate, token, useAddress, useDeliveryCheck, useHome, useMe, useMyOrders } from './shopData'

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

export function ShopHome() {
  const home = useHome()
  const address = useAddress()
  const check = useDeliveryCheck(address)
  const data = home.data
  const signedIn = Boolean(token())
  const open = data ? data.stores.filter((store) => store.openNow) : []
  const forYou = data ? (() => { const ids = [...new Set([...data.sections.topRated, ...data.sections.mostInDemand, ...data.sections.topPerformers])]; const picked = pick(data, ids).filter((store) => store.openNow); return (picked.length >= 3 ? picked : open).slice(0, 10) })() : []
  const demand = data ? pick(data, data.sections.mostInDemand).slice(0, 10) : []
  const fresh = data ? pick(data, data.sections.newest).slice(0, 10) : []
  const brands = data ? [...new Set([...data.sections.mostInDemand, ...data.sections.topRated, ...data.stores.map((store) => store.id)])].map((id) => data.stores.find((store) => store.id === id)).filter(Boolean).slice(0, 12) : []
  const outside = check && check.deliverable === false
  const me = useMe()
  const orders = useMyOrders()
  const live = orders.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status)).slice(0, 2)
  const again = data ? [...new Set(orders.filter((order) => order.status === 'DELIVERED').map((order) => order.restaurantId))].map((id) => data.stores.find((store) => store.id === id)).filter(Boolean).slice(0, 10) : []
  const name = me?.preferredName || me?.firstName

  return <div className="sp-screen sp-home">
    <Band brandText={signedIn ? `${greeting()}${name ? `, ${name}` : ''} 👋` : undefined} search={<BandSearch href="/discover" placeholder="What can we get you?" />}>
      <div className="sp-hero-desk">
        <h1>{signedIn ? `${greeting()}${name ? `, ${name}` : ''}!` : 'Food, groceries and more,'}<br /><em>{signedIn ? 'What can we get you today?' : 'delivered across Sapele.'}</em></h1>
        <div className="sp-hero-art" aria-hidden="true"><span><Burger /></span><span><Basket /></span><span><BagArt /></span><span><Parcel /></span></div>
      </div>
      <AddressPill />
    </Band>
    <main className="sp-body">
      {live.map((order) => <LiveOrderBanner key={order.id} order={order} />)}
      <nav className="sp-bubbles" aria-label="Categories">{CATEGORY_TILES.map((tile) => <Bubble key={tile.key} art={categoryArt(tile.key)} label={tile.label} href={tile.href} tone={tile.tone} size="lg" />)}</nav>

      {outside ? <OutOfArea check={check} /> : <>
        {home.status === 'loading' && <SkeletonList rows={3} />}
        {home.status === 'error' && <EmptyState title="Couldn’t load stores" body={home.error} action={<button type="button" className="sp-primary" onClick={home.reload}>Try again</button>} />}
        {data && <>
          <PromoBanners offers={data.offers} signedIn={signedIn} />
          {forYou.length > 0 ? <section className="sp-section">
            <SectionHead title="These are for you" href="/discover" />
            <Rail label="Picked for you">{forYou.map((store) => <StoreTile key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail>
          </section> : <EmptyState title="No stores open right now" body="Kitchens and shops open through the day. You can still schedule an order from a store page." action={<button type="button" className="sp-primary" onClick={() => navigate('/discover')}>Browse all stores</button>} />}
          {again.length > 0 && <section className="sp-section">
            <SectionHead title="Order again" href="/account/orders" />
            <Rail label="Order again">{again.map((store) => <StoreTile key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail>
          </section>}
          {brands.length > 2 && <section className="sp-section">
            <SectionHead title="Popular brands" href="/discover" />
            <BrandCircles stores={brands} />
          </section>}
          {demand.length > 0 && <section className="sp-section">
            <SectionHead title="Most in demand" href="/discover?section=demand" />
            <Rail label="Most in demand">{demand.map((store, position) => <StoreTile key={store.id} store={store} badge={`#${position + 1}`} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail>
          </section>}
          {fresh.length > 0 && <section className="sp-section">
            <SectionHead title="New on DOORSTEP" />
            <Rail label="New stores">{fresh.map((store) => <StoreTile key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail>
          </section>}
        </>}
      </>}

      <section className="sp-section">
        <SectionHead title="Grow with DOORSTEP" />
        <div className="sp-grow">
          <a className="sp-grow-card is-business" href="/partner/register" onClick={link('/partner/register')}><span className="sp-grow-art" aria-hidden="true"><Storefront /></span><span><b>Sell on DOORSTEP</b><small>Get orders from all over Sapele</small></span><ChevronRight size={18} aria-hidden="true" /></a>
          <a className="sp-grow-card is-rider" href="/riders" onClick={link('/riders')}><span className="sp-grow-art" aria-hidden="true"><Scooter /></span><span><b>Ride and earn</b><small>Choose your hours, keep 100% of tips</small></span><ChevronRight size={18} aria-hidden="true" /></a>
        </div>
      </section>
    </main>
    <TabBar active="home" />
  </div>
}

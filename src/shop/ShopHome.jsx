import { ChevronRight, Gift, Search, Sparkles, Tag } from 'lucide-react'
import { AddressSheet, CATEGORY_TILES, EmptyState, OutOfArea, Rail, SectionHead, ShopHeader, SkeletonList, StoreTile, TabBar } from './ShopKit'
import { navigate, token, useAddress, useDeliveryCheck, useHome } from './shopData'
import { useState } from 'react'

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

function OfferCard({ offer }) {
  return <a className="sp-offer-card" href="/account/promos" onClick={link('/account/promos')}>
    <span className="sp-offer-icon" aria-hidden="true">{offer.type === 'FREE_DELIVERY' ? <Gift size={20} /> : <Tag size={20} />}</span>
    <span><b>{offer.label}</b><small>{offer.name}{offer.code ? ` · code ${offer.code}` : offer.autoApply ? ' · applied at checkout' : ''}</small></span>
  </a>
}

export function ShopHome() {
  const home = useHome()
  const address = useAddress()
  const check = useDeliveryCheck(address)
  const [addressOpen, setAddressOpen] = useState(false)
  const data = home.data
  const signedIn = Boolean(token())
  const open = data ? data.stores.filter((store) => store.openNow) : []
  const forYou = data ? (() => { const ids = [...new Set([...data.sections.topRated, ...data.sections.mostInDemand, ...data.sections.topPerformers])]; const picked = pick(data, ids).filter((store) => store.openNow); return (picked.length >= 3 ? picked : open).slice(0, 10) })() : []
  const demand = data ? pick(data, data.sections.mostInDemand) : []
  const fresh = data ? pick(data, data.sections.newest) : []
  const welcome = data?.firstOrder?.offer && data.firstOrder.eligible !== false ? data.firstOrder.offer : null
  const outside = check && check.deliverable === false

  return <div className="sp-screen sp-home">
    <ShopHeader />
    <main className="sp-main">
      <section className="sp-hello">
        <h1>{address.label ? 'What can we get you today?' : 'Food, groceries and more — delivered in Sapele.'}</h1>
        <a className="sp-search-bar" href="/discover" onClick={link('/discover')}><Search size={18} aria-hidden="true" /><span>Search food, stores or items</span></a>
        {!address.label && <button type="button" className="sp-set-address" onClick={() => setAddressOpen(true)}>Set your delivery address to see what’s near you <ChevronRight size={15} aria-hidden="true" /></button>}
      </section>

      <nav className="sp-tiles" aria-label="Categories">{CATEGORY_TILES.map(({ key, label, icon: Icon, href, tone }) => <a key={key} href={href} onClick={link(href)} className={`sp-tile is-${tone}${key === 'FOOD' ? ' is-hero' : ''}`}>
        <span className="sp-tile-label">{label}</span>
        <span className="sp-tile-art" aria-hidden="true"><Icon size={key === 'FOOD' ? 46 : 30} strokeWidth={1.7} /></span>
      </a>)}</nav>

      {welcome && <a className="sp-welcome-banner" href={signedIn ? '/food' : '/register'} onClick={link(signedIn ? '/food' : '/register')}>
        <span className="sp-welcome-icon" aria-hidden="true"><Sparkles size={22} /></span>
        <span><b>{welcome.type === 'FREE_DELIVERY' ? 'Your first delivery is free' : `${welcome.label} your first order`}</b><small>{welcome.description || (signedIn ? 'Applied automatically at checkout.' : 'Create an account and it’s applied at checkout.')}{welcome.minSubtotalMinor ? ` Minimum basket ₦${Math.round(welcome.minSubtotalMinor / 100).toLocaleString('en-NG')}.` : ''}</small></span>
        <ChevronRight size={18} aria-hidden="true" />
      </a>}

      {outside ? <OutOfArea check={check} /> : <>
        {home.status === 'loading' && <SkeletonList rows={3} />}
        {home.status === 'error' && <EmptyState title="Couldn’t load stores" body={home.error} action={<button type="button" className="sp-primary" onClick={home.reload}>Try again</button>} />}
        {data && <>
          {data.offers.filter((offer) => offer.id !== welcome?.id).length > 0 && <section className="sp-section">
            <SectionHead title="Offers for you" href="/account/promos" />
            <Rail label="Offers">{data.offers.filter((offer) => offer.id !== welcome?.id).map((offer) => <OfferCard key={offer.id} offer={offer} />)}</Rail>
          </section>}
          {forYou.length > 0 ? <section className="sp-section">
            <SectionHead title="These are for you" href="/discover" hint="Well rated and popular around Sapele" />
            <Rail label="Picked for you">{forYou.map((store) => <StoreTile key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail>
          </section> : <EmptyState title="No stores open right now" body="Kitchens and shops open through the day. Check back soon, or schedule an order from a store page." action={<button type="button" className="sp-primary" onClick={() => navigate('/discover')}>Browse all stores</button>} />}
          {demand.length > 0 && <section className="sp-section">
            <SectionHead title="Most in demand" href="/discover?section=demand" hint="Most ordered in the last 30 days" />
            <Rail label="Most in demand">{demand.map((store) => <StoreTile key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail>
          </section>}
          {fresh.length > 0 && <section className="sp-section">
            <SectionHead title="New on DOORSTEP" />
            <Rail label="New stores">{fresh.map((store) => <StoreTile key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail>
          </section>}
        </>}
      </>}

      <section className="sp-join">
        <a href="/partner/register" onClick={link('/partner/register')}><b>Sell on DOORSTEP</b><small>Restaurants, groceries, shops and pharmacies</small></a>
        <a href="/riders" onClick={link('/riders')}><b>Ride with DOORSTEP</b><small>Earn delivering around Sapele</small></a>
      </section>
    </main>
    <TabBar active="home" />
    {addressOpen && <AddressSheet onClose={() => setAddressOpen(false)} />}
  </div>
}

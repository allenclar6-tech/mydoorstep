import { useMemo, useState } from 'react'
import { ArrowDownUp, Bike, Check, ChevronDown, Clock3, Search, Sparkles, Star, Store, UtensilsCrossed } from 'lucide-react'
import { Band, BandSearch, BasketBar, BrandCircles, Bubble, EmptyState, OutOfArea, Rail, SectionHead, Sheet, SkeletonList, StoreCard, StoreTile, TabBar } from './ShopKit'
import { SUB_ART } from './Illustrations'
import { freeDeliveryFor, pick, PromoBanners } from './ShopHome'
import { navigate, nairaWhole, ratingPercent, storeHref, storeMatches, storeSearch, SUBCATEGORIES, token, useAddress, useDeliveryCheck, useHome, VERTICALS } from './shopData'

const SUB_TONES = ['sun', 'mint', 'sky', 'rose', 'sand']
const SORTS = [['recommended', 'Recommended'], ['rating', 'Top rated'], ['fastest', 'Fastest'], ['price', 'Lowest prices'], ['popular', 'Most ordered']]

function applyFilters(stores, { sort, topRated, pickup, openOnly, free, home }) {
  let list = stores.filter((store) => (!topRated || (ratingPercent(store) ?? 0) >= 85) && (!pickup || store.pickupEnabled) && (!openOnly || store.openNow) && (!free || freeDeliveryFor(store, home)))
  const by = {
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || (b.ratingCount || 0) - (a.ratingCount || 0),
    fastest: (a, b) => (a.eta?.[0] || 99) - (b.eta?.[0] || 99),
    price: (a, b) => (a.medianPriceMinor ?? Infinity) - (b.medianPriceMinor ?? Infinity),
    popular: (a, b) => (b.ordersLast30Days || 0) - (a.ordersLast30Days || 0),
    recommended: (a, b) => Number(b.openNow) - Number(a.openNow) || (b.ordersLast30Days || 0) - (a.ordersLast30Days || 0) || (b.rating || 0) - (a.rating || 0),
  }[sort]
  list = [...list].sort(by)
  return list
}

function FilterChips({ filters, setFilters }) {
  const [sortOpen, setSortOpen] = useState(false)
  const toggle = (key) => setFilters((current) => ({ ...current, [key]: !current[key] }))
  const sortLabel = SORTS.find(([key]) => key === filters.sort)?.[1]
  return <div className="sp-filter-row" role="toolbar" aria-label="Filters">
    <button type="button" className={`sp-filter${filters.sort !== 'recommended' ? ' is-on' : ''}`} onClick={() => setSortOpen(true)}><ArrowDownUp size={14} aria-hidden="true" />{filters.sort === 'recommended' ? 'Sort by' : sortLabel}<ChevronDown size={13} aria-hidden="true" /></button>
    <button type="button" className={`sp-filter${filters.topRated ? ' is-on' : ''}`} aria-pressed={filters.topRated} onClick={() => toggle('topRated')}><Star size={14} aria-hidden="true" />Top rated</button>
    <button type="button" className={`sp-filter${filters.pickup ? ' is-on' : ''}`} aria-pressed={filters.pickup} onClick={() => toggle('pickup')}><Store size={14} aria-hidden="true" />Pickup</button>
    <button type="button" className={`sp-filter${filters.openOnly ? ' is-on' : ''}`} aria-pressed={filters.openOnly} onClick={() => toggle('openOnly')}><Clock3 size={14} aria-hidden="true" />Open now</button>
    <button type="button" className={`sp-filter${filters.free ? ' is-on' : ''}`} aria-pressed={filters.free} onClick={() => toggle('free')}><Bike size={14} aria-hidden="true" />Free delivery</button>
    {sortOpen && <Sheet title="Sort by" onClose={() => setSortOpen(false)}>
      <ul className="sp-choice-list">{SORTS.map(([key, label]) => <li key={key}><button type="button" className={filters.sort === key ? 'is-selected' : ''} onClick={() => { setFilters((current) => ({ ...current, sort: key })); setSortOpen(false) }}>{label}{filters.sort === key && <Check size={16} aria-hidden="true" />}</button></li>)}</ul>
    </Sheet>}
  </div>
}

const initialFilters = () => ({ sort: 'recommended', topRated: false, pickup: new URLSearchParams(window.location.search).get('pickup') === '1', openOnly: false, free: false })

/** Food, Groceries, Shops, Pharmacy & Beauty. */
export function VerticalPage({ vertical }) {
  const home = useHome()
  const address = useAddress()
  const check = useDeliveryCheck(address)
  const [sub, setSub] = useState(null)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState(initialFilters)
  const meta = VERTICALS[vertical]
  const subs = SUBCATEGORIES[vertical] || []
  const data = home.data
  const inVertical = useMemo(() => data ? data.stores.filter((store) => store.vertical === vertical) : [], [data, vertical])
  const visibleSubs = subs.filter((entry) => inVertical.some((store) => storeMatches(store, entry)))
  const promoActive = sub === 'promo'
  const chosenSub = subs.find((entry) => entry.key === sub)
  const matching = inVertical.filter((store) => (!chosenSub || storeMatches(store, chosenSub)) && (!promoActive || freeDeliveryFor(store, data) || data.offers.some((offer) => offer.restaurantId === store.id || offer.vertical === vertical)) && storeSearch(store, query))
  const list = data ? applyFilters(matching, { ...filters, home: data }) : []
  const popular = data ? pick(data, data.sections.mostInDemand).filter((store) => store.vertical === vertical).slice(0, 10) : []
  const anyFilter = sub || query || filters.topRated || filters.pickup || filters.openOnly || filters.free || filters.sort !== 'recommended'

  const brands = data ? (popular.length >= 3 ? popular : inVertical.filter((store) => store.openNow)).slice(0, 12) : []
  const offers = data ? data.offers.filter((offer) => !offer.vertical || offer.vertical === vertical) : []
  return <div className="sp-screen sp-vertical">
    <Band back="/" title={meta.label} search={<BandSearch value={query} onChange={setQuery} placeholder={`Search ${meta.label.toLowerCase()}`} />} />
    <main className="sp-body">
      {(visibleSubs.length > 0 || offers.length > 0) && <nav className="sp-sub-row" aria-label="Categories">
        {offers.length > 0 && <Bubble art={SUB_ART.promo} label="Promotions" tone="sun" active={promoActive} onClick={() => setSub(promoActive ? null : 'promo')} />}
        {visibleSubs.map((entry, position) => <Bubble key={entry.key} art={SUB_ART[entry.key]} label={entry.label} tone={SUB_TONES[(position + 1) % SUB_TONES.length]} active={sub === entry.key} onClick={() => setSub(sub === entry.key ? null : entry.key)} />)}
      </nav>}
      <FilterChips filters={filters} setFilters={setFilters} />
      {check && check.deliverable === false && !filters.pickup ? <OutOfArea check={check} /> : <>
        {home.status === 'loading' && <SkeletonList rows={4} />}
        {home.status === 'error' && <EmptyState title="Couldn’t load stores" body={home.error} action={<button type="button" className="sp-primary" onClick={home.reload}>Try again</button>} />}
        {data && !anyFilter && <PromoBanners offers={offers} signedIn={Boolean(token())} />}
        {data && !anyFilter && brands.length > 2 && <section className="sp-section"><SectionHead title="Popular brands" /><BrandCircles stores={brands} /></section>}
        {data && <section className="sp-section">
          <SectionHead title={anyFilter ? `${list.length} result${list.length === 1 ? '' : 's'}` : `All ${meta.label.toLowerCase()}`} />
          {list.length ? <div className="sp-store-list">{list.map((store) => <StoreCard key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</div>
            : inVertical.length ? <EmptyState icon={Search} title="Nothing matches" body="Try another category or clear a filter." action={<button type="button" className="sp-ghost" onClick={() => { setSub(null); setQuery(''); setFilters({ ...initialFilters(), pickup: false }) }}>Clear filters</button>} />
              : <EmptyState icon={Store} title={`No ${meta.label.toLowerCase()} stores yet`} body={`We’re signing up ${meta.label.toLowerCase()} businesses in Sapele. Know one? Tell them to join DOORSTEP.`} action={<button type="button" className="sp-ghost" onClick={() => navigate('/partner/register')}>Invite a business</button>} />}
        </section>}
      </>}
    </main>
    <BasketBar />
    <TabBar active="home" />
  </div>
}

const DISCOVER_SECTIONS = [
  ['demand', 'Most in demand', 'mostInDemand', 'Most ordered in the last 30 days'],
  ['budget', 'Budget friendly', 'budgetFriendly', 'Lowest typical prices'],
  ['top', 'Top restaurants', 'topRated', 'Best rated by DOORSTEP customers'],
  ['performers', 'Top performers', 'topPerformers', 'Most orders delivered this month'],
]

/** Discover: search across every store and item, plus ranked rails. */
export function DiscoverPage() {
  const home = useHome()
  const params = new URLSearchParams(window.location.search)
  const [query, setQuery] = useState(params.get('q') || '')
  const [filters, setFilters] = useState(initialFilters)
  const section = DISCOVER_SECTIONS.find(([key]) => key === params.get('section'))
  const data = home.data
  const trimmed = query.trim().toLowerCase()
  const stores = data ? applyFilters(data.stores.filter((store) => storeSearch(store, query)), { ...filters, home: data }) : []
  const dishes = data && trimmed.length >= 2 ? data.stores.flatMap((store) => (store.items || []).filter((item) => `${item.name} ${item.description || ''}`.toLowerCase().includes(trimmed)).map((item) => ({ item, store }))).slice(0, 12) : []
  const filtering = trimmed || filters.topRated || filters.pickup || filters.openOnly || filters.free || filters.sort !== 'recommended'

  return <div className="sp-screen sp-discover">
    <Band back={section ? '/discover' : undefined} title={section ? section[1] : 'Discover'} search={<BandSearch value={query} onChange={setQuery} placeholder="Search food, stores or items" autoFocus={!section && Boolean(params.get('q'))} />} />
    <main className="sp-body">
      <FilterChips filters={filters} setFilters={setFilters} />
      {home.status === 'loading' && <SkeletonList rows={4} />}
      {home.status === 'error' && <EmptyState title="Couldn’t load stores" body={home.error} action={<button type="button" className="sp-primary" onClick={home.reload}>Try again</button>} />}
      {data && section && !filtering && (() => { const list = pick(data, data.sections[section[2]]); return list.length ? <div className="sp-store-list">{list.map((store, index) => <StoreCard key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} badge={`#${index + 1}`} />)}</div> : <EmptyState icon={Sparkles} title="Not enough orders yet" body="This list fills in from real orders and reviews as DOORSTEP grows." /> })()}
      {data && !section && !filtering && <>
        {DISCOVER_SECTIONS.map(([key, title, field, hint]) => { const list = pick(data, data.sections[field]); if (!list.length) return null; return <section key={key} className="sp-section"><SectionHead title={title} hint={hint} href={`/discover?section=${key}`} /><Rail label={title}>{list.map((store) => <StoreTile key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</Rail></section> })}
        {DISCOVER_SECTIONS.every(([, , field]) => !data.sections[field].length) && <p className="sp-note">Rankings appear once stores have orders and reviews. Every store is below.</p>}
        <section className="sp-section"><SectionHead title="All stores" /><div className="sp-store-list">{applyFilters(data.stores, { ...filters, home: data }).map((store) => <StoreCard key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</div></section>
      </>}
      {data && filtering && <>
        {dishes.length > 0 && <section className="sp-section"><SectionHead title="Items" />
          <ul className="sp-dish-results">{dishes.map(({ item, store }) => <li key={`${store.id}:${item.id}`}><a href={`${storeHref(store)}#item-${item.id}`} onClick={(event) => { event.preventDefault(); navigate(`${storeHref(store)}#item-${item.id}`) }}>{item.image ? <img src={item.image} alt="" loading="lazy" /> : <span className="sp-dish-fallback" aria-hidden="true"><UtensilsCrossed size={18} /></span>}<span><b>{item.name}</b><small>{store.name}</small></span><strong>{nairaWhole(item.price)}</strong></a></li>)}</ul>
        </section>}
        <section className="sp-section"><SectionHead title={`${stores.length} store${stores.length === 1 ? '' : 's'}`} />
          {stores.length ? <div className="sp-store-list">{stores.map((store) => <StoreCard key={store.id} store={store} freeDelivery={freeDeliveryFor(store, data)} />)}</div> : <EmptyState icon={Search} title={trimmed ? `No results for “${query.trim()}”` : 'Nothing matches'} body="Try a dish name like “jollof”, a store, or clear a filter." />}
        </section>
      </>}
    </main>
    <BasketBar />
    <TabBar active="discover" />
  </div>
}

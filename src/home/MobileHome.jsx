import { BookOpen, ChevronDown, ChevronRight, Clock3, MapPin, Package, Search, ShoppingBasket, Star, Store, Tag, Utensils, X } from 'lucide-react'

const categories = [
  { label: 'Food', href: '/restaurants', icon: Utensils },
  { label: 'Groceries', href: '/groceries', icon: ShoppingBasket },
  { label: 'Markets', href: '/markets', icon: Store },
  { label: 'Send a package', href: '/send', icon: Package, featured: true },
  { label: 'Offers', href: '/offers', icon: Tag },
  { label: 'Full menu', href: '/menu', icon: BookOpen },
]

function StoreCard({ partner, onOpen }) {
  const meta = [partner.prepTimeMinutes ? `${partner.prepTimeMinutes} min` : null, partner.cuisine || null].filter(Boolean)
  return <button type="button" className="m-store" onClick={() => onOpen(partner)}>
    <span className="m-store-media">
      {partner.image ? <img src={partner.image} alt="" loading="lazy" /> : <span className="m-store-initial" aria-hidden="true">{partner.name.charAt(0)}</span>}
      {!partner.openNow && <span className="m-store-closed">Closed now</span>}
    </span>
    <span className="m-store-name">{partner.name}</span>
    <span className="m-store-meta">
      {partner.rating > 0 && <span className="m-store-rating"><Star size={12} fill="currentColor" aria-hidden="true" />{partner.rating}</span>}
      {meta.length > 0 && <span>{meta.join(' · ')}</span>}
    </span>
  </button>
}

function Rail({ title, actionLabel, onAction, loading, error, items, empty, onOpen }) {
  return <section className="m-rail" aria-label={title}>
    <header><h2>{title}</h2>{onAction && <button type="button" onClick={onAction}>{actionLabel}<ChevronRight size={16} aria-hidden="true" /></button>}</header>
    {loading ? <div className="m-rail-track" aria-busy="true">{[0, 1, 2].map((key) => <span key={key} className="m-store m-store-skeleton" aria-hidden="true"><span className="m-store-media" /><span className="m-skel-line" /><span className="m-skel-line short" /></span>)}</div>
      : error ? <p className="m-rail-note">{error}</p>
        : items.length === 0 ? <p className="m-rail-note">{empty}</p>
          : <div className="m-rail-track">{items.map((partner) => <StoreCard key={partner.id} partner={partner} onOpen={onOpen} />)}</div>}
  </section>
}

/**
 * Phone-first home screen: address and search up top, category bubbles,
 * then horizontal store rails. Shown only on small screens (see mobileHome.css);
 * desktop keeps the existing home page.
 */
export function MobileHome({ deliveryLocation, search, onSearch, restaurants, groceries, loading, error, onOpenPartner, onNavigate, cartCount, cartTotalLabel, onOpenCart }) {
  const hasAddress = deliveryLocation && deliveryLocation !== 'Amukpe, Sapele'
  return <div className="m-home">
    <div className="m-home-top">
      <button type="button" className="m-address" onClick={() => onNavigate('/location')} aria-label={hasAddress ? `Delivering to ${deliveryLocation}. Change address` : 'Set your delivery address'}>
        <MapPin size={18} aria-hidden="true" />
        <span><small>{hasAddress ? 'Delivering to' : 'Where should we deliver?'}</small><strong>{hasAddress ? deliveryLocation : 'Set your address'}</strong></span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <label className="m-search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Search restaurants and dishes</span>
        <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Restaurants, dishes, cuisines" enterKeyHint="search" />
        {search && <button type="button" aria-label="Clear search" onClick={() => onSearch('')}><X size={16} /></button>}
      </label>
    </div>

    <div className="m-home-sheet">
      {!search && <nav className="m-bubbles" aria-label="Categories">
        {categories.map(({ label, href, icon: Icon, featured }) => <button key={href} type="button" className={featured ? 'm-bubble is-featured' : 'm-bubble'} onClick={() => onNavigate(href)}>
          <span className="m-bubble-icon" aria-hidden="true"><Icon size={26} strokeWidth={2.2} /></span>
          <span className="m-bubble-label">{label}</span>
        </button>)}
      </nav>}

      {!search && <button type="button" className="m-send-card" onClick={() => onNavigate('/send')}>
        <span className="m-send-copy"><strong>Need something moved across Sapele?</strong><span>Book a rider from your door to theirs. You see the road distance and the price before you pay.</span></span>
        <span className="m-send-icon" aria-hidden="true"><Package size={30} strokeWidth={2} /></span>
      </button>}

      <Rail
        title={search ? `Results for “${search}”` : 'Restaurants'}
        actionLabel="See all"
        onAction={() => onNavigate('/restaurants')}
        loading={loading}
        error={error}
        items={restaurants}
        empty={search ? 'No approved restaurant matches that search yet.' : 'No restaurants are taking orders yet.'}
        onOpen={onOpenPartner}
      />
      {!search && <Rail title="Groceries" actionLabel="See all" onAction={() => onNavigate('/groceries')} loading={loading} error={error} items={groceries} empty="No grocery stores are taking orders yet." onOpen={onOpenPartner} />}

      {!search && <section className="m-promise" aria-label="How DOORSTEP works">
        <p><Clock3 size={16} aria-hidden="true" />Prep times come from each kitchen; delivery time is estimated from the road route.</p>
        <p><MapPin size={16} aria-hidden="true" />Pin your exact entrance so your rider finds you first time.</p>
      </section>}
    </div>

    {cartCount > 0 && <button type="button" className="m-cart-bar" onClick={onOpenCart}>
      <span className="m-cart-count">{cartCount}</span>
      <span>View basket</span>
      <strong>{cartTotalLabel}</strong>
    </button>}
  </div>
}

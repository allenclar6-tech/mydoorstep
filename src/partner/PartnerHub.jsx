import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { BarChart3, Bell, ChefHat, ChevronRight, CircleHelp, Clock3, LayoutDashboard, MessageCircle, Package, PackageCheck, Pause, Play, Settings, Star, Store, Utensils, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { Basket, Burger, MoneyBag, PhoneOrders, Storefront } from '../shop/Illustrations'
import { authHeaders, firstNameOf, go, Hello, naira, Shortcuts, timeOf, useEscape, usePolling, WeekChart, WorkspaceFrame } from '../workspace/WorkspaceFrame'

// Partner workspace (restaurants and shops): live store status, a "Today" screen and
// a phone tab bar with the number of orders in progress. The frame is shared with riders.

const PartnerContext = createContext({ today: null, user: null, business: null, reload: () => undefined })
export const usePartner = () => useContext(PartnerContext)

/** Loads the Today numbers and refreshes them every 30 seconds (and when the tab comes back). */
function usePartnerData() {
  const [today, setToday] = useState(null)
  const [user, setUser] = useState(null)
  const [business, setBusiness] = useState(null)
  const reload = useCallback(() => fetch(`${apiBase}/api/restaurant/today`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (body) setToday(body) }).catch(() => undefined), [])
  usePolling(reload)
  useEffect(() => {
    Promise.all([fetch(`${apiBase}/api/auth/me`, { headers: authHeaders() }), fetch(`${apiBase}/api/restaurant/profile`, { headers: authHeaders() })])
      .then(async ([me, profile]) => [me.ok ? await me.json() : null, profile.ok ? await profile.json() : null])
      .then(([me, profile]) => { if (me?.user) setUser(me.user); if (profile?.restaurant) setBusiness(profile.restaurant) })
      .catch(() => undefined)
  }, [])
  return { today, user, business, reload }
}

/** Open / paused / closed, in words a busy kitchen can read at a glance. */
export function statusOf(store) {
  if (!store) return { tone: 'muted', label: 'Loading…', detail: '' }
  if (store.paused) return { tone: 'paused', label: 'Paused', detail: store.pausedUntil ? `Back at ${timeOf(store.pausedUntil)}` : 'Until you reopen' }
  if (!store.approved) return { tone: 'muted', label: 'Not live yet', detail: 'Waiting for DOORSTEP approval' }
  if (!store.openNow) return { tone: 'closed', label: 'Closed', detail: store.openingTime ? `Opens at ${store.openingTime}` : 'Outside opening hours' }
  return { tone: 'open', label: 'Open', detail: 'Taking orders' }
}

const inProgress = (today) => today ? today.live.new + today.live.preparing + today.live.ready : 0

const PAGE_TITLES = { '/restaurant/orders': 'Orders', '/restaurant/menu': 'Menu', '/restaurant/menu/new': 'Menu', '/restaurant/profile': 'Store & account', '/restaurant/settings': 'Store & account', '/restaurant/earnings': 'Money', '/restaurant/notifications': 'Notifications', '/restaurant/support': 'Help', '/restaurant/security': 'Sign-in & security' }

export function PartnerShell({ path, children }) {
  const data = usePartnerData()
  const grocery = (data.today?.store?.storeType || data.business?.storeType) === 'GROCERY'
  const store = data.today?.store
  const isHome = path === '/restaurant/dashboard' || path === '/restaurant' || path === '/restaurant/'
  const nav = [
    { label: 'Today', href: '/restaurant/dashboard', icon: LayoutDashboard, active: isHome },
    { label: 'Orders', href: '/restaurant/orders', icon: Package, active: path === '/restaurant/orders', count: inProgress(data.today) },
    { label: grocery ? 'Products' : 'Menu', href: '/restaurant/menu', icon: Utensils, active: path.startsWith('/restaurant/menu') },
    { label: 'Money', href: '/restaurant/earnings', icon: BarChart3, active: path === '/restaurant/earnings' },
    { label: 'Store & account', href: '/restaurant/profile', icon: Store, active: path === '/restaurant/profile' || path === '/restaurant/settings' },
  ]
  const extra = [{ label: 'Notifications', href: '/restaurant/notifications', icon: Bell }, { label: 'Help chat', href: '/restaurant/support', icon: MessageCircle }, { label: 'Settings', href: '/restaurant/settings', icon: Settings }]
  return <PartnerContext.Provider value={data}>
    <WorkspaceFrame path={path} home="/restaurant/dashboard" brandSub={grocery ? 'Shop partner' : 'Partner'} label="Partner"
      name={store?.name || data.business?.name || 'Your store'} image={store?.image || data.business?.coverImageUrl} status={statusOf(store)}
      nav={nav} extra={extra} account={{ label: 'Store and account', href: '/restaurant/profile' }} title={PAGE_TITLES[path]}
      greetingName={firstNameOf(data.user)} withdrawHref="/restaurant/earnings" isHome={isHome}>{children}</WorkspaceFrame>
  </PartnerContext.Provider>
}

const PAUSES = [[15, '15 minutes', 'A quick breather'], [30, '30 minutes', 'Kitchen is full'], [60, '1 hour', 'Short of staff or stock'], [120, '2 hours', 'Something came up'], [null, 'Until I reopen', 'You switch it back on yourself']]

function StatusHero({ store, reload }) {
  const [sheet, setSheet] = useState(false)
  useEscape(sheet, () => setSheet(false))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [, tick] = useState(0)
  useEffect(() => { if (!store?.pausedUntil) return undefined; const timer = setInterval(() => { tick((value) => value + 1); if (new Date(store.pausedUntil) <= new Date()) reload() }, 20_000); return () => clearInterval(timer) }, [store?.pausedUntil, reload])
  const status = statusOf(store)
  const send = async (body) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiBase}/api/restaurant/pause`, { method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Couldn’t save. Check your internet and try again.')
      setSheet(false); await reload()
    } catch (sendError) { setError(sendError.message) } finally { setBusy(false) }
  }
  const minutesLeft = store?.pausedUntil ? Math.max(1, Math.round((new Date(store.pausedUntil) - Date.now()) / 60_000)) : null
  const headline = { open: 'You’re open', paused: 'Orders paused', closed: 'You’re closed', muted: status.label }[status.tone]
  const copy = { open: 'Customers can see your store and order now.', paused: minutesLeft ? `New orders start again in about ${minutesLeft} min (at ${timeOf(store.pausedUntil)}).` : 'Customers can’t order until you reopen.', closed: `${status.detail}. Customers can still schedule orders for later.`, muted: status.detail }[status.tone]
  return <section className={`ph-hero is-${status.tone}`}>
    <div className="ph-hero-copy">
      <span className="ph-pill"><i aria-hidden="true" />{status.label}</span>
      <h2>{headline}</h2>
      <p>{copy}</p>
      {error && <p className="ph-error" role="alert">{error}</p>}
      {store && <div className="ph-hero-actions">
        {status.tone === 'paused'
          ? <button type="button" className="ph-btn is-light" disabled={busy} onClick={() => send({ open: true })}><Play size={17} aria-hidden="true" />{busy ? 'Reopening…' : 'Reopen now'}</button>
          : <button type="button" className="ph-btn is-ghost" disabled={busy || status.tone === 'muted'} onClick={() => setSheet(true)}><Pause size={17} aria-hidden="true" />Pause new orders</button>}
        <button type="button" className="ph-btn is-link" onClick={() => go('/restaurant/profile')}><Clock3 size={16} aria-hidden="true" />Opening hours</button>
      </div>}
    </div>
    <div className="ph-hero-art" aria-hidden="true"><Storefront /></div>
    {sheet && <div className="ph-sheet-layer" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSheet(false) }}>
      <section className="ph-sheet" role="dialog" aria-modal="true" aria-label="Pause new orders">
        <header><span className="ph-sheet-badge"><Pause size={18} aria-hidden="true" /></span><span><b>Pause new orders</b><small>Orders you already have keep going. Customers see “Paused”.</small></span><button type="button" className="ph-icon-btn" onClick={() => setSheet(false)} aria-label="Close"><X size={18} /></button></header>
        <div className="ph-pause-list">{PAUSES.map(([minutes, label, hint]) => <button key={label} type="button" disabled={busy} onClick={() => send({ minutes })}><b>{label}</b><small>{hint}</small><ChevronRight size={16} aria-hidden="true" /></button>)}</div>
        {error && <p className="ph-error" role="alert">{error}</p>}
      </section>
    </div>}
  </section>
}

function LiveTiles({ live }) {
  const tiles = [['new', 'New', 'Accept them quickly', Bell], ['preparing', 'Preparing', 'In your kitchen', ChefHat], ['ready', 'Ready', 'Waiting for a rider', PackageCheck]]
  return <section className="ph-live" aria-label="Orders in progress">
    {tiles.map(([key, label, hint, Icon]) => <button key={key} type="button" className={`ph-live-tile is-${key}${key === 'new' && live[key] > 0 ? ' is-ringing' : ''}`} onClick={() => go('/restaurant/orders')}>
      <span className="ph-live-icon" aria-hidden="true"><Icon size={18} /></span>
      <strong>{live[key]}</strong>
      <span><b>{label}</b><small>{hint}</small></span>
    </button>)}
  </section>
}

function BestSellers({ best, grocery }) {
  return <section className="ph-card">
    <div className="ph-card-head"><div><h3>Best sellers</h3><p>Most ordered this week</p></div></div>
    {best.length ? <ol className="ph-best">{best.map((item, index) => <li key={item.name}><span className={`ph-rank is-${index + 1}`}>{index + 1}</span><b>{item.name}</b><small>{item.count} sold</small></li>)}</ol>
      : <div className="ph-empty-mini"><span aria-hidden="true">{grocery ? <Basket /> : <Burger />}</span><p>Your top {grocery ? 'products' : 'dishes'} will show here after your first orders.</p></div>}
  </section>
}

const partnerShortcuts = (grocery) => [
  { art: grocery ? Basket : Burger, title: grocery ? 'Add a product' : 'Add a dish', hint: 'Photos help customers choose', href: '/restaurant/menu/new', tone: 'sun' },
  { art: Storefront, title: 'Store & hours', hint: 'Opening times, prep time, map pin', href: '/restaurant/profile', tone: 'mint' },
  { art: MoneyBag, title: 'Money', hint: 'Balance, payouts and withdrawals', href: '/restaurant/earnings', tone: 'sky' },
  { art: PhoneOrders, title: 'Get help', hint: 'Chat with the DOORSTEP team', href: '/restaurant/support', tone: 'rose' },
]

/** The partner home screen. `extras` are the setup checklist, balance and notification cards. */
export function PartnerToday({ extras }) {
  const { today, reload, user } = usePartner()
  const grocery = today?.store?.storeType === 'GROCERY'
  if (!today) return <div className="ph-page"><div className="ph-skeleton is-hero" /><div className="ph-skeleton-row"><div className="ph-skeleton" /><div className="ph-skeleton" /><div className="ph-skeleton" /></div></div>
  const rating = today.store.ratingCount > 0 ? today.store.rating.toFixed(1) : null
  return <div className="ph-page">
    <Hello name={firstNameOf(user)} />
    <StatusHero store={today.store} reload={reload} />
    <LiveTiles live={today.live} />
    {today.live.onTheWay > 0 && <p className="ph-note"><Package size={15} aria-hidden="true" />{today.live.onTheWay} order{today.live.onTheWay === 1 ? ' is' : 's are'} on the way to customers.</p>}
    <section className="ph-stats" aria-label="Today">
      <div className="ph-stat is-sales"><small>Sales today</small><strong>{naira(today.today.salesMinor)}</strong><span>Food & goods value</span></div>
      <div className="ph-stat"><small>Orders today</small><strong>{today.today.orders}</strong><span>{today.today.orders ? `Average ${naira(today.today.averageMinor)}` : 'None yet — they’re coming'}</span></div>
      <div className="ph-stat"><small>Rating</small><strong>{rating ? <>{rating}<Star size={18} aria-hidden="true" /></> : 'New'}</strong><span>{rating ? `${today.store.ratingCount} review${today.store.ratingCount === 1 ? '' : 's'}` : 'Reviews appear after orders'}</span></div>
    </section>
    {extras && <div className="ph-extras">{extras}</div>}
    <div className="ph-two">
      <WeekChart summary={`${today.weekTotals.orders} order${today.weekTotals.orders === 1 ? '' : 's'} · ${naira(today.weekTotals.salesMinor)} in sales`} week={today.week.map((day) => ({ ...day, amountMinor: day.salesMinor }))} linkLabel="Money" linkHref="/restaurant/earnings" />
      <BestSellers best={today.best} grocery={grocery} />
    </div>
    <h3 className="ph-section-title">Shortcuts</h3>
    <Shortcuts items={partnerShortcuts(grocery)} />
    <p className="ph-foot"><CircleHelp size={15} aria-hidden="true" />Numbers update every 30 seconds. Sales are the value of your food or goods, before DOORSTEP’s commission.</p>
  </div>
}

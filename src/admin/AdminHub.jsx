import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Bell, Bike, Calculator, ChefHat, ChevronDown, ClipboardList, CreditCard, Download, FileText, LayoutDashboard, MapPin, MessageCircle, Package, Settings, Star, Store, Tag, Truck, Users, Wallet } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { MapPinArt, MoneyBag, Parcel, PercentTag, Scooter, Storefront } from '../shop/Illustrations'
import { firstNameOf, go, Hello, naira, Shortcuts, usePolling, WeekChart, WorkspaceFrame } from '../workspace/WorkspaceFrame'
import { AdminTodo } from './AdminTodo'

// Admin control centre: the shared workspace frame, a Glovo-style Home and a short plain-English
// guide at the top of every page ("What this page is for" + 3 steps).

const adminHeaders = () => { let token = null; try { token = localStorage.getItem('doorstep-admin-token') } catch { token = null } return { Authorization: `Bearer ${token}` } }

/** Admin menu: plain words, grouped like a delivery company’s back office. */
export const ADMIN_MENU = [
  { group: 'Today', label: 'Home', href: '/admin/dashboard', icon: LayoutDashboard },
  { group: 'Today', label: 'Live deliveries', short: 'Live', href: '/admin/deliveries', icon: MapPin },
  { group: 'Today', label: 'Orders', href: '/admin/orders', icon: ClipboardList },
  { group: 'Today', label: 'Package deliveries', href: '/admin/parcels', icon: Truck },
  { group: 'Approve new partners', label: 'Restaurants', href: '/admin/restaurants', icon: ChefHat },
  { group: 'Approve new partners', label: 'Shops & groceries', href: '/admin/groceries', icon: Store },
  { group: 'Approve new partners', label: 'Riders', href: '/admin/riders', icon: Bike },
  { group: 'Customers', label: 'Customers', href: '/admin/customers', icon: Users },
  { group: 'Customers', label: 'Help messages', href: '/admin/support', icon: MessageCircle },
  { group: 'Customers', label: 'Reviews', href: '/admin/reviews', icon: Star },
  { group: 'Money', label: 'Money & payouts', short: 'Money', href: '/admin/finance', icon: Wallet },
  { group: 'Money', label: 'How customers pay', href: '/admin/payments', icon: CreditCard },
  { group: 'Money', label: 'Promo codes', href: '/admin/promos', icon: Tag },
  { group: 'Delivery setup', label: 'Delivery prices', href: '/admin/pricing', icon: Calculator },
  { group: 'Delivery setup', label: 'Places in Sapele', href: '/admin/locations', icon: MapPin },
  { group: 'Reports', label: 'Sales report', href: '/admin/analytics', icon: BarChart3 },
  { group: 'Reports', label: 'Activity log', href: '/admin/audit-logs', icon: FileText },
]
const ADMIN_EXTRA = [{ label: 'Notifications', href: '/admin/notifications', icon: Bell }, { label: 'Download the app', href: '/admin/download', icon: Download }, { label: 'Settings', href: '/admin/settings', icon: Settings }]

/** What each page is for, in one plain sentence, and how to use it in three steps. */
export const ADMIN_GUIDES = {
  '/admin/deliveries': { what: 'Every delivery happening right now, and orders still waiting for a rider.', steps: ['Look at “Waiting for a rider” first — those customers are waiting.', 'Tap “Send a rider” to give the job to the nearest free rider.', 'Watch it move to “On the way”. Call the rider if it stays stuck.'] },
  '/admin/orders': { what: 'All customer orders, newest first.', steps: ['Find an order by its number or the customer’s name.', 'Open it to see the items, the payment and where it is now.', 'If a customer complains, check the status here before you reply.'] },
  '/admin/parcels': { what: 'Packages customers asked DOORSTEP to pick up and drop off.', steps: ['Check new bookings and that each one is paid.', 'Make sure a rider has taken each paid booking.', 'Use the price button to change package delivery prices.'] },
  '/admin/restaurants': { what: 'Food businesses asking to sell on DOORSTEP.', steps: ['Open a request and read the business details.', 'Open their documents and check the name, address and phone.', 'Tap Approve to put them live, Reject with a reason, or ask for more information.'] },
  '/admin/groceries': { what: 'Shops, supermarkets and pharmacies asking to sell on DOORSTEP.', steps: ['Open a request and read the shop details.', 'Open their documents and check them.', 'Approve to put them live, Reject with a reason, or ask for more information.'] },
  '/admin/riders': { what: 'People asking to deliver for DOORSTEP.', steps: ['Open a request and check their ID, phone and vehicle.', 'Only approve people you have checked — riders carry customers’ orders.', 'Once approved, they can go online and get jobs.'] },
  '/admin/customers': { what: 'Everyone with a customer account.', steps: ['Find a customer by name, email or phone.', 'See when they joined and whether their account is active.', 'Suspend an account only for fraud or abuse — they won’t be able to order.'] },
  '/admin/support': { what: 'Messages from customers, businesses and riders.', steps: ['Open “Needs a reply” first — oldest messages at the top.', 'Reply in simple words. Use the quick replies to save time.', 'Mark it solved when the problem is fixed.'] },
  '/admin/reviews': { what: 'Ratings and comments customers left after orders.', steps: ['Read new reviews.', 'Approve fair reviews, even bad ones — they help customers choose.', 'Reject only reviews that are rude, fake or share private details.'] },
  '/admin/finance': { what: 'All the money: what came in, DOORSTEP’s share, and what we owe businesses and riders.', steps: ['Check “To pay out” — that’s money owed to partners and riders.', 'Approve withdrawal requests after checking the bank details.', 'Set DOORSTEP’s cut (commission) and rider pay in the settings below.'] },
  '/admin/payments': { what: 'How customers can pay: card (Paystack) or bank transfer.', steps: ['Turn each payment method on or off.', 'When someone pays by bank transfer, check your bank, then confirm it in “Transfers to confirm”.', 'Confirming releases the order to the business.'] },
  '/admin/promos': { what: 'Discounts and promo codes for customers.', steps: ['Tap “New offer” and choose the type, like free delivery or 10% off.', 'Choose who gets it, the minimum order and the end date.', 'Switch it off any time. DOORSTEP pays for the discount, not the business.'] },
  '/admin/pricing': { what: 'What customers pay for delivery and what riders earn per trip.', steps: ['Use “Easy setup” and tap “Use suggested prices”.', 'Check the table to see the price at each distance.', 'Tap “Save and turn on”. New orders use the new prices straight away.'] },
  '/admin/locations': { what: 'Areas, streets and landmarks in Sapele. Delivery prices use them.', steps: ['Open places that “Need review”.', 'Check the pin is in the right spot on the map — move it if not.', 'Verify places you or a rider have confirmed. Reject wrong ones.'] },
  '/admin/analytics': { what: 'Sales and money numbers over time.', steps: ['See total sales and DOORSTEP’s share.', 'Compare with last week to spot busy and quiet days.', 'Nothing here changes money — it’s for reading only.'] },
  '/admin/audit-logs': { what: 'A record of who changed what, and when. It keeps everyone honest.', steps: ['Look here if something changed and you don’t know why.', 'Each line shows the person, the action and the time.', 'You can’t edit this list — that’s on purpose.'] },
  '/admin/settings': { what: 'Basic rules for the whole app.', steps: ['Read each setting’s note before you change it.', 'Change one thing at a time.', 'Check the customer app afterwards to see the change.'] },
}

const GUIDE_KEY = 'doorstep-admin-guides-closed'
const readClosed = () => { try { return JSON.parse(localStorage.getItem(GUIDE_KEY) || '[]') } catch { return [] } }

/** “How this page works” card. Folds away, and remembers that on this device. */
export function PageGuide({ path }) {
  const guide = ADMIN_GUIDES[path]
  const [closed, setClosed] = useState(() => readClosed().includes(path))
  useEffect(() => { setClosed(readClosed().includes(path)) }, [path])
  if (!guide) return null
  const toggle = () => {
    const next = !closed
    setClosed(next)
    try { const list = readClosed().filter((item) => item !== path); localStorage.setItem(GUIDE_KEY, JSON.stringify(next ? [...list, path] : list)) } catch { /* private mode */ }
  }
  return <section className={`ad-guide${closed ? ' is-closed' : ''}`}>
    <button type="button" className="ad-guide-head" onClick={toggle} aria-expanded={!closed}>
      <span className="ad-guide-badge" aria-hidden="true">?</span>
      <span><b>{closed ? 'How this page works' : guide.what}</b>{closed && <small>{guide.what}</small>}</span>
      <ChevronDown size={18} aria-hidden="true" />
    </button>
    {!closed && <ol className="ad-guide-steps">{guide.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>}
  </section>
}

export function useAdminSummary() {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => fetch(`${apiBase}/api/admin/summary`, { headers: adminHeaders() }).then(async (response) => {
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(response.status === 401 ? 'You’ve been signed out. Please sign in again.' : 'Couldn’t load today’s numbers.')
    setSummary(body); setError('')
  }).catch((loadError) => setError(loadError instanceof TypeError ? 'We can’t reach DOORSTEP. Check your internet.' : loadError.message)), [])
  usePolling(load)
  return { summary, error }
}

export function AdminShell({ path, children }) {
  const { summary } = useAdminSummary()
  const [user, setUser] = useState(null)
  useEffect(() => { fetch(`${apiBase}/api/auth/me`, { headers: adminHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (body?.user) setUser(body.user) }).catch(() => undefined) }, [])
  const isHome = path === '/admin/dashboard' || path === '/admin' || path === '/admin/'
  const nav = ADMIN_MENU.map((item) => ({ ...item, active: item.href === '/admin/dashboard' ? isHome : path === item.href, count: item.href === '/admin/deliveries' ? summary?.live?.waitingRider || 0 : 0 }))
  const current = [...ADMIN_MENU, ...ADMIN_EXTRA].find((item) => item.href === path)
  const status = summary ? { tone: 'open', label: 'Owner', detail: `${summary.ridersOnline ?? 0} rider${summary.ridersOnline === 1 ? '' : 's'} online` } : { tone: 'muted', label: 'Owner', detail: '' }
  return <WorkspaceFrame path={path} home="/admin/dashboard" brandSub="Control centre" label="Admin" admin bellTokenKey="doorstep-admin-token"
    name={user ? `${firstNameOf(user)} ${user.lastName || ''}`.trim() : 'DOORSTEP owner'} image={null} status={status}
    nav={nav} extra={ADMIN_EXTRA} account={{ label: 'Settings', href: '/admin/settings' }} title={current?.label} greetingName={firstNameOf(user)}
    withdrawHref={null} isHome={isHome} tabs={['/admin/dashboard', '/admin/orders', '/admin/deliveries', '/admin/finance']}>
    {!isHome && <PageGuide path={path} />}
    {children}
  </WorkspaceFrame>
}

const ADMIN_SHORTCUTS = [
  { art: Storefront, title: 'Approve partners', hint: 'New restaurants, shops and riders', href: '/admin/restaurants', tone: 'sun' },
  { art: Scooter, title: 'Send a rider', hint: 'Orders waiting for a rider', href: '/admin/deliveries', tone: 'mint' },
  { art: MoneyBag, title: 'Money & payouts', hint: 'Transfers, withdrawals, commission', href: '/admin/finance', tone: 'sky' },
  { art: PercentTag, title: 'Make a promo', hint: 'Free delivery or % off', href: '/admin/promos', tone: 'rose' },
  { art: Parcel, title: 'Delivery prices', hint: 'Price by distance, rider pay', href: '/admin/pricing', tone: 'mint' },
  { art: MapPinArt, title: 'Places in Sapele', hint: 'Check and pin addresses', href: '/admin/locations', tone: 'sun' },
]

/** Admin Home: what’s happening now, what needs you, and today’s numbers. */
export function AdminHome({ extras }) {
  const { summary, error } = useAdminSummary()
  const [user, setUser] = useState(null)
  useEffect(() => { fetch(`${apiBase}/api/auth/me`, { headers: adminHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (body?.user) setUser(body.user) }).catch(() => undefined) }, [])
  const live = summary?.live || { waitingBusiness: 0, preparing: 0, waitingRider: 0, onTheWay: 0 }
  const week = summary?.week || []
  const weekSales = week.reduce((sum, day) => sum + day.amountMinor, 0)
  const weekOrders = week.reduce((sum, day) => sum + day.count, 0)
  const tiles = [
    ['waitingBusiness', 'Waiting for the business', 'Not accepted yet', Bell, '/admin/orders', 'new'],
    ['preparing', 'Being prepared', 'In kitchens and shops', ChefHat, '/admin/orders', 'preparing'],
    ['waitingRider', 'Need a rider', 'Send one now', Package, '/admin/deliveries', 'ready'],
    ['onTheWay', 'On the way', 'With riders', Bike, '/admin/deliveries', 'preparing'],
  ]
  return <div className="ph-page">
    <Hello name={firstNameOf(user)} />
    {error && <p className="rider-status-alert is-error" role="alert">{error}</p>}
    <section className="ph-hero is-open ad-hero">
      <div className="ph-hero-copy">
        <span className="ph-pill"><i aria-hidden="true" />Live</span>
        <h2>{summary ? `${summary.ordersToday} order${summary.ordersToday === 1 ? '' : 's'} today` : 'Today on DOORSTEP'}</h2>
        <p>{summary ? `${naira(summary.grossSalesMinor)} in paid orders · ${summary.ridersOnline ?? 0} rider${summary.ridersOnline === 1 ? '' : 's'} online now` : 'Loading today’s numbers…'}</p>
        <div className="ph-hero-actions"><button type="button" className="ph-btn is-sun" onClick={() => go('/admin/deliveries')}><MapPin size={17} aria-hidden="true" />Open live deliveries</button></div>
      </div>
      <div className="ph-hero-art" aria-hidden="true"><Scooter /></div>
    </section>
    <section className="ph-live ad-live" aria-label="Orders right now">
      {tiles.map(([key, label, hint, Icon, href, tone]) => <button key={key} type="button" className={`ph-live-tile is-${tone}${key === 'waitingRider' && live[key] > 0 ? ' is-ringing' : ''}`} onClick={() => go(href)}>
        <span className="ph-live-icon" aria-hidden="true"><Icon size={18} /></span>
        <strong>{live[key]}</strong>
        <span><b>{label}</b><small>{hint}</small></span>
      </button>)}
    </section>
    <AdminTodo />
    <section className="ph-stats ad-stats" aria-label="Your marketplace">
      <div className="ph-stat"><small>Customers</small><strong>{summary ? summary.customers.toLocaleString('en-NG') : '…'}</strong><span>With an account</span></div>
      <div className="ph-stat"><small>Live partners</small><strong>{summary ? summary.restaurants + summary.groceries : '…'}</strong><span>{summary ? `${summary.restaurants} food · ${summary.groceries} shops` : 'Loading'}</span></div>
      <div className="ph-stat"><small>Approved riders</small><strong>{summary ? summary.riders : '…'}</strong><span>{summary ? `${summary.ridersOnline ?? 0} online now` : 'Loading'}</span></div>
      <div className="ph-stat"><small>Waiting approval</small><strong>{summary ? summary.pendingApprovals : '…'}</strong><span>{summary?.pendingApprovals ? <button type="button" className="ph-link" onClick={() => go('/admin/restaurants')}>Review them</button> : 'All done'}</span></div>
    </section>
    {extras && <div className="ph-extras">{extras}</div>}
    {week.length > 0 && <WeekChart title="Paid orders, last 7 days" summary={`${weekOrders} order${weekOrders === 1 ? '' : 's'} · ${naira(weekSales)}`} week={week} linkLabel="Sales report" linkHref="/admin/analytics" />}
    <h3 className="ph-section-title">Quick actions</h3>
    <Shortcuts items={ADMIN_SHORTCUTS} />
    <p className="ph-foot">Numbers refresh every 30 seconds. “Paid orders” counts only orders that were paid — unpaid checkouts are left out.</p>
  </div>
}


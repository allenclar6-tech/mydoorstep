import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Bike, Bell, Check, Clock3, DollarSign, MapPin, Menu, Package, Settings, ShieldCheck, Store, Truck } from 'lucide-react'
import { formatNaira } from './data'
import { SessionSignOutButton } from './authControls'
import { RiderAccount } from './RiderAccount'
import { WorkspaceTabBar } from './mobile/WorkspaceTabBar'
import { NotificationBell, WorkspaceInbox } from './notifications/NotificationCenter'
import { ProfileCompletenessCard } from './account/ProfileCompleteness'
import { SignInMethodsPage } from './auth/AltSignIn'
import { AvailabilityLocationToggle, RiderParcelJobs } from './rider/RiderParcelJobs'
import { apiBase } from './config/apiBase'

const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }

const riderNav = [['Dashboard', '/rider/dashboard', Truck], ['Available deliveries', '/rider/deliveries', Package], ['Delivery history', '/rider/history', Clock3], ['Earnings', '/rider/earnings', DollarSign], ['Verification', '/rider/verification', ShieldCheck], ['Rider account', '/rider/account', Settings]]
const stages = ['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER', 'DELIVERED']

function RiderShell({ path, children }) {
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState(null)
  useEffect(() => { fetch(`${apiBase}/api/auth/me`, { headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}` } }).then((response) => response.ok ? response.json() : null).then((body) => body?.user && setUser(body.user)).catch(() => undefined) }, [])
  const name = user ? `${user.firstName} ${user.lastName}` : 'Rider'
  return <div className="portal-shell"><aside className={open ? 'portal-sidebar is-open' : 'portal-sidebar'}><div className="portal-logo"><span className="brand-mark">✦</span><span>doorstep<span>rider</span></span></div><div className="portal-restaurant"><div className="portal-avatar">{name.charAt(0)}</div><div><strong>{name}</strong><small>Authenticated rider</small></div></div><nav>{riderNav.map(([label, href, Icon]) => <button className={path === href ? 'portal-nav active' : 'portal-nav'} key={href} onClick={() => { navigate(href); setOpen(false) }}><Icon size={17} />{label}</button>)}</nav><div className="portal-sidebar-bottom"><button className="portal-nav" onClick={() => { navigate('/rider/notifications'); setOpen(false) }}><Bell size={17} />Notifications</button><button className="portal-nav" onClick={() => { navigate('/rider/account'); setOpen(false) }}><Settings size={17} />Account settings</button><SessionSignOutButton className="portal-nav" /></div></aside><main className="portal-main"><header className="portal-header"><button className="portal-menu-toggle" onClick={() => setOpen(!open)} aria-label="Open rider menu"><Menu size={21} /></button><div><span className="section-kicker">RIDER PORTAL</span><h1>{user ? `Hi, ${user.firstName}` : 'Rider workspace'}</h1></div><div className="portal-header-actions"><NotificationBell className="portal-bell" label="Rider notifications" /><button className="portal-bell" aria-label="Open rider account" onClick={() => navigate('/rider/account')}><Settings size={18} /></button></div></header>{children}</main>{open && <button type="button" className="ws-sheet-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}<WorkspaceTabBar label="Rider navigation" path={path} onMore={() => setOpen(true)} items={[{ label: 'Today', href: '/rider/dashboard', icon: Truck, match: (current) => current === '/rider/dashboard' || current === '/rider' }, { label: 'Jobs', href: '/rider/deliveries', icon: Package }, { label: 'History', href: '/rider/history', icon: Clock3 }, { label: 'Earnings', href: '/rider/earnings', icon: DollarSign }]} /></div>
}

function RiderIntro({ eyebrow, title, action }) { return <div className="portal-intro"><div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2></div>{action}</div> }

function RiderLocationSharing({ deliveryId, active }) {
  const watchId = useRef(null)
  const socket = useRef(null)
  const [state, setState] = useState('idle')
  const [message, setMessage] = useState('Start sharing when you begin this active delivery. Your location is only sent to authorized delivery participants.')

  const stop = () => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current)
    watchId.current = null
    socket.current?.close()
    socket.current = null
  }
  useEffect(() => () => stop(), [])
  useEffect(() => {
    if (!active) {
      stop()
      setState('idle')
    }
  }, [active])

  const sendLocation = async (position) => {
    const location = { type: 'location', latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp }
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(location))
      setState('sharing')
      setMessage('Location sharing is active for this delivery.')
      return
    }
    const response = await fetch(`${apiBase}/api/deliveries/${deliveryId}/location`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(location) })
    if (!response.ok) throw new Error('Location update could not be delivered')
    setState('sharing')
    setMessage('Live connection is restoring. Your latest location was sent securely.')
  }
  const start = () => {
    if (!navigator.geolocation) {
      setState('error')
      setMessage('This browser does not support location sharing. Use a current mobile browser to continue.')
      return
    }
    const token = localStorage.getItem('doorstep-token')
    if (!token) {
      setState('error')
      setMessage('Your rider session has expired. Sign in again before sharing your location.')
      return
    }
    stop()
    setState('requesting')
    setMessage('Allow precise location when your browser asks. It is used only while this delivery is active.')
    const websocketUrl = new URL(`${apiBase}/api/deliveries/${deliveryId}/live`)
    websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    socket.current = new WebSocket(websocketUrl, ['bearer', token])
    socket.current.onclose = () => { if (watchId.current !== null) setMessage('Live connection lost. Location updates will use the secure backup connection.') }
    socket.current.onerror = () => socket.current?.close()
    watchId.current = navigator.geolocation.watchPosition(
      (position) => { sendLocation(position).catch(() => { setState('error'); setMessage('We could not send this location. Check your connection and keep this delivery active.') }) },
      (error) => {
        stop()
        setState('error')
        setMessage(error.code === error.PERMISSION_DENIED ? 'Location permission was denied. Enable precise location in your browser settings to share this delivery.' : error.code === error.TIMEOUT ? 'Location took too long to respond. Move to a clearer area and try sharing again.' : 'Your current location is unavailable. Check GPS and try again.')
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    )
  }
  return <div className={`rider-location-sharing ${state}`}><strong>Live location</strong><p>{message}</p>{state === 'sharing' ? <button type="button" className="portal-secondary" onClick={() => { stop(); setState('idle'); setMessage('Location sharing is paused.') }}>Pause sharing</button> : <button type="button" className="portal-primary" disabled={!active || state === 'requesting'} onClick={start}><MapPin size={16} />{state === 'requesting' ? 'Requesting location...' : 'Start location sharing'}</button>}</div>
}

function CurrentDelivery({ delivery, setDelivery }) {
  const stage = stages.indexOf(delivery.status)
  const next = stages[stage + 1]
  const active = next !== undefined
  const advance = async () => { const response = await fetch(`${apiBase}/api/deliveries/by-order/${encodeURIComponent(delivery.order)}/status`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) }); if (response.ok) setDelivery({ ...delivery, status: next }) }
  return <section className="rider-delivery-card"><div className="delivery-card-head"><div><span className="section-kicker">ACTIVE DELIVERY</span><h3>{delivery.order}</h3></div><span className="portal-status accepted">{delivery.status.replaceAll('_', ' ')}</span></div><div className="delivery-route"><div><Store size={17} /><span><small>Pickup</small><strong>{delivery.restaurant}</strong><em>{delivery.pickup}</em></span></div><div className="route-line" /><div><MapPin size={17} /><span><small>Drop-off</small><strong>{delivery.customer}</strong><em>{delivery.dropoff}</em></span></div></div><RiderLocationSharing deliveryId={delivery.id} active={active} />{next ? <button className="portal-primary" onClick={advance}>{next === 'DELIVERED' ? <Check size={16} /> : <ArrowRight size={16} />} {next.replaceAll('_', ' ')}</button> : <div className="delivered-label"><Check size={17} /> Delivery completed</div>}</section>
}

function onlineFor(since, now) {
  if (!since) return ''
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000))
  if (minutes < 1) return 'Online just now'
  if (minutes < 60) return `Online for ${minutes} min`
  return `Online for ${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The big go-online switch: one tap, clear state, never pretends a change happened. */
function AvailabilitySwitch({ online, onlineSince, approved, loading, busy, onToggle }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!online) return undefined; const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer) }, [online])
  const disabled = loading || busy || (!approved && !online)
  const title = loading ? 'Checking your status…' : online ? 'You’re online' : 'You’re offline'
  const detail = loading ? 'One moment.' : !approved && !online ? 'You can go online once DOORSTEP approves your rider account.' : online ? `${onlineFor(onlineSince, now) || 'Online'} · new job requests will reach you` : 'Go online to start receiving delivery requests near you.'
  return <section className={`rider-availability${online ? ' is-online' : ''}${busy ? ' is-busy' : ''}`} aria-live="polite">
    <span className="rider-availability-dot" aria-hidden="true" />
    <div className="rider-availability-text"><strong>{title}</strong><span>{detail}</span></div>
    <button type="button" role="switch" aria-checked={online} aria-label={online ? 'Go offline' : 'Go online'} className="rider-switch" disabled={disabled} onClick={onToggle}>
      <span className="rider-switch-track"><span className="rider-switch-thumb" /></span>
      <span className="rider-switch-label">{busy ? (online ? 'Going offline…' : 'Going online…') : online ? 'Go offline' : 'Go online'}</span>
    </button>
  </section>
}

function RiderDashboard() {
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [online, setOnline] = useState(false)
  const [onlineSince, setOnlineSince] = useState(null)
  const [switching, setSwitching] = useState(false)
  const [toggleError, setToggleError] = useState('')
  const [toggleNote, setToggleNote] = useState('')
  const [delivery, setDelivery] = useState(null)
  const [activeParcel, setActiveParcel] = useState(null)
  const token = localStorage.getItem('doorstep-token')
  const loadSummary = () => fetch(`${apiBase}/api/rider/summary`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => {
    const body = await response.json()
    if (!response.ok) throw new Error(body.message || 'Could not load your rider summary.')
    setSummary(body)
    setOnline(body.availability === 'ONLINE')
    setOnlineSince(body.onlineSince || null)
    setSummaryError('')
  }).catch((error) => setSummaryError(error instanceof TypeError ? 'We could not reach DOORSTEP. Check your connection — we will keep trying.' : error.message))
  // Keep the dashboard honest if availability changes on another device, and retry after network drops.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) loadSummary() }
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh) }
  }, [token])
  useEffect(() => {
    loadSummary()
    fetch(`${apiBase}/api/rider/deliveries`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => {
      const active = body.deliveries?.find((item) => item.riderId && item.order)
      if (active) setDelivery({ id: active.id, order: active.order.orderNumber, restaurant: active.order.restaurant.name, pickup: active.order.restaurant.address, customer: 'Customer', dropoff: active.order.addressSnapshot, status: active.status })
    }).catch(() => undefined)
  }, [token])
  const toggleOnline = async () => {
    if (switching) return
    const next = online ? 'OFFLINE' : 'ONLINE'
    setToggleError(''); setToggleNote(''); setSwitching(true)
    try {
      const response = await fetch(`${apiBase}/api/rider/availability`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ availability: next }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error === 'RIDER_NOT_APPROVED' ? 'Your rider account must be approved before you can go online.' : response.status === 401 ? 'Your session has expired. Sign in again.' : 'Could not change your availability. Try again.')
      setOnline(body.rider.availability === 'ONLINE')
      setOnlineSince(body.rider.onlineSince || null)
      if (next === 'OFFLINE' && body.activeDeliveries > 0) setToggleNote('You are offline for new jobs. Please finish the delivery you already accepted.')
      loadSummary()
    } catch (error) { setToggleError(error instanceof TypeError ? 'No connection. Your status did not change — try again when you are back online.' : error.message) } finally { setSwitching(false) }
  }
  const approved = summary?.approval === 'APPROVED'
  const metric = (value) => summary ? value : '…'
  return <><RiderIntro eyebrow="TODAY AT A GLANCE" title={online ? 'You’re on the road.' : 'Ready for the next good trip?'} />
    <AvailabilitySwitch online={online} onlineSince={onlineSince} approved={approved} loading={!summary && !summaryError} busy={switching} onToggle={toggleOnline} />
    {toggleError && <p className="rider-status-alert is-error" role="alert">{toggleError}</p>}
    {toggleNote && <p className="rider-status-alert" role="status">{toggleNote}</p>}
    {summaryError && <p className="rider-status-alert is-error" role="alert">{summaryError}</p>}
    <ProfileCompletenessCard className="ws-pc" />
    {summary && !approved && <div className="demo-banner"><span>APPROVAL PENDING</span><p>DOORSTEP operations must approve your rider account before you can go online or accept deliveries.</p></div>}
    <section className="metric-grid">
      <div><span>Delivered today</span><strong>{metric(summary?.today.completedDeliveries)}</strong><small>{summary ? `${summary.activeDeliveries} active now` : 'Loading'}</small></div>
      <div><span>Recorded earnings today</span><strong>{summary ? formatNaira(Math.round(summary.today.recordedEarningsMinor / 100)) : '…'}</strong><small>From payout records</small></div>
      <div><span>All-time deliveries</span><strong>{metric(summary?.completedDeliveries)}</strong><small>Completed</small></div>
      <div><span>Your rating</span><strong>{summary?.rating ? <>{summary.rating.average.toFixed(1)} <em>★</em></> : summary ? 'New' : '…'}</strong><small>{summary?.rating ? `From ${summary.rating.count} rating${summary.rating.count === 1 ? '' : 's'}` : 'No ratings yet'}</small></div>
    </section>
    <AvailabilityLocationToggle online={online} />
    <section className="rider-layout">
      <div className="rider-work-column">
        {delivery && <CurrentDelivery delivery={delivery} setDelivery={setDelivery} />}
        {activeParcel && <RiderLocationSharing deliveryId={activeParcel.deliveryId} active />}
        {!delivery && <RiderParcelJobs online={online} approved={approved} onActiveChange={setActiveParcel} />}
      </div>
      <div className="portal-panel"><div className="panel-heading"><div><span className="section-kicker">DELIVERY CARE</span><h3>Before you move</h3></div></div><div className="rider-care"><Bike size={20} /><p>Live location is shared with the customer only during an active delivery, and only while this page is open in your browser. Keep the screen on during deliveries.</p></div><button className="text-link" onClick={() => navigate('/rider/verification')}>View verification <ArrowRight size={14} /></button></div>
    </section></>
}

function Available() { const [deliveries, setDeliveries] = useState([]); const token = localStorage.getItem('doorstep-token'); useEffect(() => { fetch(`${apiBase}/api/rider/deliveries`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => setDeliveries(body.deliveries || [])).catch(() => undefined) }, []); const claim = async (id) => { const response = await fetch(`${apiBase}/api/deliveries/${id}/claim`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); if (response.ok) navigate('/rider/dashboard') }; return <><RiderIntro eyebrow="AVAILABLE DELIVERIES" title="Choose your next route." /><section className="orders-panel">{deliveries.filter((delivery) => delivery.status === 'AVAILABLE').map((delivery) => <div className="portal-order-row" key={delivery.id}><div className="order-id"><strong>{delivery.order.orderNumber}</strong><small>{delivery.order.restaurant.name}</small></div><div className="order-items">{delivery.order.restaurant.address} → {delivery.order.addressSnapshot}</div><strong>{formatNaira(delivery.order.deliveryFeeMinor / 100)}</strong><button className="small-action" onClick={() => claim(delivery.id)}>Accept</button></div>)}{deliveries.length === 0 && <div className="empty-state">No delivery requests are available right now.</div>}</section></> }

function History() { const [orders, setOrders] = useState([]); const token = localStorage.getItem('doorstep-token'); useEffect(() => { fetch(`${apiBase}/api/rider/history`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => setOrders(body.orders || [])).catch(() => undefined) }, []); return <><RiderIntro eyebrow="DELIVERY HISTORY" title="Every trip, accounted for." /><section className="orders-panel">{orders.map((order) => <div className="portal-order-row" key={order.id}><div className="order-id"><strong>{order.orderNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString('en-NG')} · {order.restaurant?.name}</small></div><div className="order-items">Completed delivery</div><strong>{formatNaira(Math.round((order.riderPayout?.amountMinor || 0) / 100))}</strong><span className="portal-status delivered">{order.status}</span></div>)}{orders.length === 0 && <div className="empty-state">No rider history is available yet.</div>}</section></> }

function Earnings() { const [totalMinor, setTotalMinor] = useState(0); const [payouts, setPayouts] = useState([]); const token = localStorage.getItem('doorstep-token'); useEffect(() => { fetch(`${apiBase}/api/rider/earnings`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => { setTotalMinor(body.totalMinor || 0); setPayouts(body.payouts || []) }).catch(() => undefined) }, []); return <><RiderIntro eyebrow="RIDER EARNINGS" title="Know what every delivery earns." /><section className="metric-grid"><div><span>Completed deliveries</span><strong>{payouts.length}</strong><small>Recorded deliveries</small></div><div><span>Delivery earnings</span><strong>{formatNaira(Math.round(totalMinor / 100))}</strong><small>Recorded payout value</small></div><div><span>Paid out</span><strong>{formatNaira(Math.round(payouts.filter((payout) => payout.status === 'PAID').reduce((sum, payout) => sum + payout.amountMinor, 0) / 100))}</strong><small>Completed payouts</small></div><div><span>Pending payout</span><strong>{formatNaira(Math.round(payouts.filter((payout) => payout.status !== 'PAID').reduce((sum, payout) => sum + payout.amountMinor, 0) / 100))}</strong><small>Awaiting processing</small></div></section><section className="portal-panel earnings-note"><DollarSign size={26} /><div><h3>Server-owned earnings</h3><p>Your payout history is calculated from completed delivery records and cannot be changed from the browser.</p></div></section></> }

function Verification() { return <><RiderIntro eyebrow="VERIFICATION" title="Keep your rider record ready." /><section className="portal-panel verification-panel"><ShieldCheck size={23} /><div><h3>Verification is operations-controlled</h3><p>Identity, vehicle, and safety documents are reviewed privately by DOORSTEP operations before delivery access is enabled.</p></div></section></> }

export function RiderPortal({ path }) { let content = <RiderDashboard />; if (path === '/rider/deliveries') content = <Available />; if (path === '/rider/history') content = <History />; if (path === '/rider/earnings') content = <Earnings />; if (path === '/rider/verification') content = <Verification />; if (path === '/rider/account' || path === '/rider/settings') content = <RiderAccount initialSection={path === '/rider/settings' ? 'rider' : 'profile'} />; if (path === '/rider/security') content = <SignInMethodsPage backHref="/rider/account" />; if (path === '/rider/notifications') content = <WorkspaceInbox title="Notifications" subtitle="New pickups, customer requests, cancellations and account updates." />; return <RiderShell path={path}>{content}</RiderShell> }

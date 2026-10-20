import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, CreditCard, Bell, Camera, Check, Clock3, HelpCircle, Home, KeyRound, LogOut, MapPin, Search, Send, Settings, ShieldCheck, ShoppingBag, Sparkles, Star, Store, Truck, UserCircle, Utensils } from 'lucide-react'
import { categories, formatNaira, sapeleLocations } from './data'
import { PasswordField } from './PasswordField'
import { ProfileAvatar } from './ProfileAvatar'
import { GroceryOwnerApplication } from './GroceryOwnerApplication'
import { ApplicationReviewSummary, clearApplicationDraft, getApplicationReview, restoreApplicationDraft, saveApplicationDraft } from './ApplicationReview'
import { applicationSubmissionError, validateOpeningHours } from './applicationValidation'
import { useDeliveryTracking } from './tracking/useDeliveryTracking'
import { SavedCardChoices, useSavedCards } from './account/SavedCards'
import { ProfileCompletenessCard } from './account/ProfileCompleteness'
import { BusinessRegistrationField } from './partner/BusinessRegistrationField'
import { HelpPage as SupportChatPage } from './support/HelpChat'
import { ApplicationUpdates } from './partner/ApplicationUpdates'
import { readConfirmedLocation } from './location'
import { signOut as endSession } from './services/authService'
import { loadCart } from './services/orderService'
import { SignInLinks, SignOutNotice } from './authControls'
import { NotificationsScreen, useNotifications } from './notifications/NotificationCenter'
import { AlternativeSignIn, PHONE_HANDOFF_KEY, SignInMethodsPage, useAuthProviders } from './auth/AltSignIn'
import { ORDER_STATUS_LABELS, OrderActionButtons, orderStatusTone } from './orders/OrderActions'
import { apiBase } from './config/apiBase'

const NavigationPage = lazy(() => import('./navigation/NavigationPage'))
const PaymentMethodsPage = lazy(() => import('./account/SavedCards').then((module) => ({ default: module.PaymentMethodsPage })))
// Map components pull in mapbox-gl, so they load only on the pages that show a map.
const LocationMap = lazy(() => import('./LocationMap').then((module) => ({ default: module.LocationMap })))
const DeliveryTrackingMap = lazy(() => import('./DeliveryTrackingMap').then((module) => ({ default: module.DeliveryTrackingMap })))
const mapFallback = <div className="empty-state" role="status">Loading map…</div>
const ParcelRoutes = lazy(() => import('./parcel/ParcelRoutes'))
const PaymentResultPage = lazy(() => import('./parcel/ParcelRoutes').then((module) => ({ default: module.PaymentResult })))

const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }

export function MobileStoreDock() {
  const path = window.location.pathname
  const [cartCount, setCartCount] = useState(() => loadCart().reduce((count, item) => count + item.quantity, 0))
  const isExcludedRoute = ['/login', '/register', '/forgot-password', '/reset-password', '/location', '/send'].includes(path) || path.startsWith('/partners/') || path.startsWith('/riders/') || path.startsWith('/partner/') || path === '/rider/register'
  const isSignedIn = Boolean(localStorage.getItem('doorstep-token'))

  useEffect(() => {
    const refreshCart = () => setCartCount(loadCart().reduce((count, item) => count + item.quantity, 0))
    window.addEventListener('doorstep-cart-change', refreshCart)
    window.addEventListener('storage', refreshCart)
    return () => {
      window.removeEventListener('doorstep-cart-change', refreshCart)
      window.removeEventListener('storage', refreshCart)
    }
  }, [])

  const { unreadCount } = useNotifications('doorstep-token', Boolean(localStorage.getItem('doorstep-token')) && !isExcludedRoute)

  // Hooks above must run on every render; only now is it safe to bail out.
  if (!isSignedIn || isExcludedRoute) return null

  // Five destinations, app-style. Alerts live on the header bell, the basket on the home screen bar,
  // and sign-out on the account page.
  const items = [
    { label: 'Home', href: '/', icon: Home, active: path === '/' },
    { label: 'Stores', href: '/restaurants', icon: Store, active: path.startsWith('/restaurants') || path.startsWith('/groceries') || path === '/markets' || path === '/menu' || path === '/offers' },
    { label: 'Send', href: '/send', icon: Truck, active: path === '/send' || path.startsWith('/parcels'), featured: true },
    { label: 'Orders', href: '/account/orders', icon: Clock3, badge: unreadCount, active: path === '/track-order' || path.startsWith('/account/orders') || path === '/account/notifications' },
    { label: 'Account', href: '/account', avatar: true, active: path === '/account' || (path.startsWith('/account/') && !path.startsWith('/account/orders') && path !== '/account/notifications') },
  ]
  return <nav className="mobile-store-dock" aria-label="Primary mobile navigation">{items.map(({ label, href, icon: Icon, badge, avatar, active, action, featured }) => <a key={label} href={href} onClick={(event) => { if (action) { event.preventDefault(); action(); return } event.preventDefault(); navigate(href) }} className={`${active ? 'is-active' : ''}${featured ? ' is-featured' : ''}`.trim() || undefined} aria-current={active ? 'page' : undefined}>{avatar ? <ProfileAvatar className="mobile-store-avatar" size={19} /> : <span className="mobile-store-icon"><Icon size={19} />{badge > 0 && <b>{badge > 99 ? '99+' : badge}</b>}</span>}<span>{label}</span></a>)}</nav>
}

function PageFrame({ eyebrow, title, intro, children, className = '' }) {
  return <main className={`route-page ${className}`.trim()}><div className="route-hero"><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{intro}</p></div>{children}<MobileStoreDock /></main>
}

function DiscoveryPage({ offers = false, grocery = false, market = false }) {
  const [query, setQuery] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [liveRestaurants, setLiveRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const typeQuery = grocery ? '&type=GROCERY' : market ? '' : '&type=RESTAURANT'
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetch(`${apiBase}/api/restaurants?limit=24${typeQuery}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Approved partner listings are temporarily unavailable.')
        return response.json()
      })
      .then((body) => { if (active) setLiveRestaurants(body.restaurants || []) })
      .catch((loadError) => { if (active) setError(loadError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [typeQuery])
  const visible = liveRestaurants.filter((restaurant) => (!openOnly || restaurant.openNow !== false) && (!query || `${restaurant.name} ${restaurant.cuisine || restaurant.description || ''} ${(restaurant.items || []).map((item) => item.name).join(' ')}`.toLowerCase().includes(query.toLowerCase())))
  const title = grocery ? 'Groceries, delivered today.' : market ? 'Everything local, in one market.' : offers ? 'Good food, better timing.' : 'Find your next favourite.'
  const intro = grocery ? 'Fresh produce, pantry staples, drinks, and household essentials delivered across Sapele.' : market ? 'Browse approved restaurants, grocery stores, and their available products in one place.' : offers ? 'Limited-time offers from the local kitchens we love. Every campaign is configured by the DOORSTEP team.' : 'Browse approved restaurants, compare delivery times, and find something worth sharing.'
  return <PageFrame eyebrow={grocery ? 'GROCERIES' : market ? 'DOORSTEP MARKETS' : offers ? 'DOORSTEP DEALS' : 'DISCOVER SAPELE'} title={title} intro={intro}>{offers && <section className="route-grid offer-services-grid"><article className="route-restaurant"><div><span className="section-kicker">FOOD DELIVERY</span><h2>Restaurant meals</h2><p>Browse approved local restaurants and their currently available menus.</p><button className="text-link" type="button" onClick={() => navigate('/restaurants')}>Find restaurants <ArrowRight size={15} /></button></div></article><article className="route-restaurant"><div><span className="section-kicker">GROCERY DELIVERY</span><h2>Everyday essentials</h2><p>Shop approved grocery stores for available household and pantry items.</p><button className="text-link" type="button" onClick={() => navigate('/groceries')}>Explore groceries <ArrowRight size={15} /></button></div></article><article className="route-restaurant"><div><span className="section-kicker">NEED DETAILS?</span><h2>We're here to help.</h2><p>Get support with orders, payments, delivery, accounts, or partnering with DOORSTEP.</p><button className="text-link" type="button" onClick={() => navigate('/help')}>Contact support <ArrowRight size={15} /></button></div></article></section>}<section className="discovery-toolbar"><div className="route-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={grocery ? 'Search groceries or stores' : market ? 'Search restaurants, groceries, or products' : 'Search restaurants or dishes'} /></div><label className="filter-check"><input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} /> Open now</label></section>{error ? <div className="empty-state" role="alert">{error}</div> : loading ? <div className="empty-state" role="status">Loading approved partner listings...</div> : <><section className="route-grid">{visible.map((restaurant) => { const isGrocery = restaurant.type === 'GROCERY'; return <article className="route-restaurant" key={restaurant.id}>{restaurant.image && <img src={restaurant.image} alt={restaurant.name} />}<div><div className="route-restaurant-top"><h2>{restaurant.name}</h2>{restaurant.rating > 0 && <span><Star size={14} fill="currentColor" /> {restaurant.rating}</span>}</div><p>{restaurant.cuisine || restaurant.description || 'Approved local partner'}</p><small><Clock3 size={13} /> {restaurant.time || `${restaurant.openingTime || '09:00'}–${restaurant.closingTime || '22:00'}`} · {restaurant.fee || 'Delivery calculated at checkout'}</small><button className="text-link" onClick={() => navigate(`${isGrocery ? '/groceries/' : '/restaurants/'}${restaurant.slug || restaurant.name.toLowerCase().replaceAll(' ', '-')}`)}>View {isGrocery ? 'store' : 'menu'} <ArrowRight size={15} /></button></div></article> })}</section>{visible.length === 0 && <div className="empty-state">No {grocery ? 'approved grocery stores or products' : market ? 'approved restaurants, grocery stores, or products' : 'approved restaurants'} match that search yet.</div>}</>}</PageFrame>
}

function CategoryPage() { return <DiscoveryPage /> }

function MenuDirectoryPage() {
  const [liveStores, setLiveStores] = useState(null)
  const [error, setError] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  useEffect(() => {
    let active = true
    fetch(`${apiBase}/api/restaurants?limit=50&type=GROCERY`)
      .then(async (response) => {
        if (!response.ok) throw new Error('The latest menus are temporarily unavailable.')
        return response.json()
      })
      .then((body) => {
        if (active) setLiveStores(body.restaurants || [])
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
    return () => { active = false }
  }, [])
  const stores = (liveStores || []).map((store) => ({
    ...store,
    kind: store.type === 'GROCERY' ? 'Grocery store' : 'Restaurant',
    itemCount: store.items?.length || 0,
    path: `${store.type === 'GROCERY' ? '/groceries/' : '/restaurants/'}${store.slug || store.name.toLowerCase().replaceAll(' ', '-')}`,
  }))
  const foodCategories = useMemo(() => {
    const categories = new Map()
    stores.filter((store) => store.type === 'RESTAURANT').forEach((store) => {
      ;(store.items || []).forEach((item) => {
        const category = item.category?.trim() || 'Other dishes'
        const current = categories.get(category) || []
        current.push({ ...item, store })
        categories.set(category, current)
      })
    })
    return [...categories.entries()].sort(([first], [second]) => first.localeCompare(second))
  }, [liveStores])
  const visibleCategories = selectedCategory ? foodCategories.filter(([category]) => category === selectedCategory) : foodCategories
  return <PageFrame eyebrow="DOORSTEP FOOD MENU" title="Find food by type." intro="Browse dishes from every restaurant on DOORSTEP, grouped by type. New dishes appear as soon as restaurants add them.">{error ? <p role="alert" className="profile-message">{error}</p> : liveStores === null ? <div className="empty-state" role="status">Loading approved restaurant menus...</div> : foodCategories.length === 0 ? <div className="empty-state">No approved restaurant dishes are available yet.</div> : <><section className="menu-category-filter" aria-label="Food categories"><button className={selectedCategory ? '' : 'is-active'} type="button" onClick={() => setSelectedCategory('')}>All food</button>{foodCategories.map(([category, items]) => <button className={selectedCategory === category ? 'is-active' : ''} type="button" key={category} onClick={() => setSelectedCategory(category)}>{category} <span>{items.length}</span></button>)}</section><section className="menu-category-results">{visibleCategories.map(([category, items]) => <section className="menu-category-group" key={category}><div className="section-heading"><div><span className="section-kicker">FOOD TYPE</span><h2>{category}</h2></div><span>{items.length} available</span></div><div className="menu-directory-grid">{items.map(({ store, ...item }) => <button className="menu-directory-card" key={item.id} type="button" onClick={() => navigate(store.path)}>{item.image && <img src={item.image} alt="" loading="lazy" />}<div className="menu-directory-card-content"><span>{store.name}</span><h3>{item.name}</h3><p>{item.description || 'Available from this approved restaurant.'}</p><small>{formatNaira(item.price)} <ArrowRight size={15} /></small></div></button>)}</div></section>)}</section><section className="menu-directory-stores"><div className="section-heading"><div><span className="section-kicker">BROWSE BY PARTNER</span><h2>Approved restaurants</h2></div></div><div className="menu-directory-grid">{stores.filter((store) => store.type === 'RESTAURANT').map((store) => <button className="menu-directory-card" key={store.id} type="button" onClick={() => navigate(store.path)}>{store.image && <img src={store.image} alt={store.name} loading="lazy" />}<div className="menu-directory-card-content"><span>Restaurant</span><h3>{store.name}</h3><p>{store.cuisine || store.description || 'Approved local partner'}</p><small>{store.itemCount} menu items <ArrowRight size={15} /></small></div></button>)}</div></section></>}</PageFrame>
}

function MarketBrowsePage() {
  const [partners, setPartners] = useState(null)
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch(`${apiBase}/api/restaurants?limit=50`)
      .then(async (response) => {
        if (!response.ok) throw new Error('The market catalog is temporarily unavailable.')
        return response.json()
      })
      .then((body) => { if (active) setPartners(body.restaurants || []) })
      .catch((loadError) => { if (active) setError(loadError.message) })
    return () => { active = false }
  }, [])

  const catalog = useMemo(() => (partners || []).flatMap((partner) => (partner.items || []).map((item) => ({
    ...item,
    category: item.category?.trim() || 'Essentials',
    partner,
    partnerPath: `${partner.type === 'GROCERY' ? '/groceries/' : '/restaurants/'}${partner.slug || partner.name.toLowerCase().replaceAll(' ', '-')}`,
  }))), [partners])
  const categories = useMemo(() => [...new Set(catalog.map((item) => item.category))].sort((first, second) => first.localeCompare(second)), [catalog])
  const normalizedQuery = query.trim().toLowerCase()
  const results = catalog.filter((item) => (!selectedCategory || item.category === selectedCategory) && (!normalizedQuery || `${item.name} ${item.description || ''} ${item.category} ${item.partner.name} ${item.partner.type}`.toLowerCase().includes(normalizedQuery)))
  const groupedResults = useMemo(() => {
    const groups = new Map()
    results.forEach((item) => groups.set(item.category, [...(groups.get(item.category) || []), item]))
    return [...groups.entries()].sort(([first], [second]) => first.localeCompare(second))
  }, [results])

  return <PageFrame eyebrow="DOORSTEP MARKETS" title="Browse grocery products and essentials." intro="Search currently available products and everyday essentials from approved DOORSTEP grocery stores."><section className="discovery-toolbar"><div className="route-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products, essentials, or grocery stores" aria-label="Search the markets catalog" /></div></section>{error ? <div className="empty-state" role="alert">{error}</div> : partners === null ? <div className="empty-state" role="status">Loading approved grocery products...</div> : catalog.length === 0 ? <div className="empty-state">No approved grocery products are available yet.</div> : <><section className="menu-category-filter" aria-label="Market categories"><button className={selectedCategory ? '' : 'is-active'} type="button" onClick={() => setSelectedCategory('')}>All categories</button>{categories.map((category) => <button className={selectedCategory === category ? 'is-active' : ''} type="button" key={category} onClick={() => setSelectedCategory(category)}>{category}</button>)}</section><section className="menu-category-results">{groupedResults.map(([category, items]) => <section className="menu-category-group" key={category}><div className="section-heading"><div><span className="section-kicker">GROCERY ESSENTIALS</span><h2>{category}</h2></div><span>{items.length} available</span></div><div className="menu-directory-grid">{items.map((item) => <button className="menu-directory-card" key={item.id} type="button" onClick={() => navigate(item.partnerPath)}>{item.image && <img src={item.image} alt="" loading="lazy" />}<div className="menu-directory-card-content"><span>Grocery · {item.partner.name}</span><h3>{item.name}</h3><p>{item.description || `Available from ${item.partner.name}.`}</p><small>{formatNaira(item.price)} <ArrowRight size={15} /></small></div></button>)}</div></section>)}</section>{results.length === 0 && <div className="empty-state">No available product or essential matches “{query}”.</div>}</>}</PageFrame>
}

function LegacyAuthPage({ register = false }) {
  const [role, setRole] = useState('customer')
  const [submitted, setSubmitted] = useState(false)
  if (submitted) return <PageFrame eyebrow="WELCOME TO DOORSTEP" title="You’re on your way." intro="Thanks for signing up. We will guide you through the next step."><div className="submitted-card"><Check size={24} /><h2>{role === 'customer' ? 'Account request received' : `${role} portal selected`}</h2><p>We’ll take you to the correct dashboard after authentication is connected.</p><button className="primary-button" onClick={() => navigate('/')}>Back to home <ArrowRight size={16} /></button></div></PageFrame>
  return <PageFrame eyebrow={register ? 'CREATE YOUR ACCOUNT' : 'WELCOME BACK'} title={register ? 'Create your account.' : 'Sign in.'} intro={register ? 'Tell us how you will use DOORSTEP and we will set up the right account.' : 'Choose how you use DOORSTEP to sign in.'}><section className="auth-layout"><div className="role-picker"><button className={role === 'customer' ? 'role-card selected' : 'role-card'} onClick={() => setRole('customer')}><Utensils size={23} /><strong>I’m ordering food</strong><span>Customer account</span></button><button className={role === 'restaurant' ? 'role-card selected' : 'role-card'} onClick={() => setRole('restaurant')}><Store size={23} /><strong>I own a restaurant</strong><span>Restaurant partner</span></button><button className={role === 'rider' ? 'role-card selected' : 'role-card'} onClick={() => setRole('rider')}><Truck size={23} /><strong>I want to deliver</strong><span>Rider account</span></button></div><form className="auth-form" onSubmit={(event) => { event.preventDefault(); setSubmitted(true) }}><h2>{register ? 'Create account' : 'Log in'}</h2>{register && <div className="form-row"><label>First name<input required name="firstName" /></label><label>Last name<input required name="lastName" /></label></div>}<label>Email address<input required type="email" name="email" /></label>{register ? <label>Phone number<input required type="tel" name="phone" /></label> : <PasswordField required label="Password" name="password" />}{register && <PasswordField required label="Password" name="password" />}<label className="terms-check"><input type="checkbox" required /> I agree to the DOORSTEP terms and privacy policy.</label><button className="checkout-button" type="submit">{register ? 'Create account' : 'Continue'} <ArrowRight size={17} /></button><p className="form-footnote">{register ? 'Already have an account? ' : 'New to DOORSTEP? '}<button type="button" onClick={() => navigate(register ? '/login' : '/register')}>{register ? 'Log in' : 'Create an account'}</button></p></form></section></PageFrame>
}

function AuthPage({ register = false, portalRole = 'CUSTOMER' }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    const endpoint = register ? '/api/auth/register' : '/api/auth/login'
    const payload = register ? { ...values, phone: values.phone, verificationId: values.verificationId } : { email: values.email, password: values.password }
    try {
      const response = await fetch(`${apiBase}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error === 'ACCOUNT_ALREADY_EXISTS' ? 'An account with this email already exists.' : body.error === 'INVALID_CREDENTIALS' ? 'Email or password is incorrect.' : body.error === 'ACCOUNT_PENDING_APPROVAL' ? 'Your application is still under review. We’ll let you know when portal access is ready.' : body.error || 'Authentication failed.')
      if (body.user.role !== portalRole) throw new Error(`This account is ${body.user.role.toLowerCase()} access, not ${portalRole.toLowerCase()} access.`)
      localStorage.setItem('doorstep-token', body.token)
      localStorage.setItem('doorstep-role', body.user.role)
      const requestedReturn = new URLSearchParams(window.location.search).get('return') || ''
      const safeReturn = /^\/(?!\/)[\w\-/?=&.%]*$/.test(requestedReturn) ? requestedReturn : ''
      const destination = body.user.role === 'RESTAURANT' ? '/restaurant/dashboard' : body.user.role === 'RIDER' ? '/rider/dashboard' : safeReturn || '/account/orders'
      navigate(destination)
    } catch (authError) { setError(authError.message) } finally { setBusy(false) }
  }
  const title = register ? 'Create your customer account' : portalRole === 'CUSTOMER' ? 'Log in to DOORSTEP' : `${portalRole === 'RESTAURANT' ? 'Partner' : 'Rider'} portal login`
  const roleCopy = portalRole === 'CUSTOMER' ? { eyebrow: 'CUSTOMER ACCESS', title: 'Your next good meal starts here.', intro: 'Sign in to continue orders, track deliveries, save favourites, and keep your account details ready.', heading: 'Welcome back', detail: 'Your personal food marketplace for Sapele.' } : portalRole === 'RESTAURANT' ? { eyebrow: 'RESTAURANT OWNER ACCESS', title, intro: 'Sign in to manage your kitchen, menus, paid orders, and restaurant earnings from one protected workspace.', heading: 'Run your kitchen with clarity', detail: 'Orders, menus, and payouts stay connected to your approved restaurant.' } : { eyebrow: 'RIDER ACCESS', title, intro: 'Sign in to manage availability, accept deliveries, update stages, and review your delivery earnings securely.', heading: 'Ready for the next route', detail: 'Your rider workspace keeps each handoff visible and accountable.' }
  const registrationPath = portalRole === 'RESTAURANT' ? '/partner/register' : portalRole === 'RIDER' ? '/rider/register' : '/register'
  return <PageFrame className="auth-entry-page" eyebrow={register ? 'CREATE YOUR ACCOUNT' : roleCopy.eyebrow} title={register ? title : roleCopy.title} intro={register ? 'Create a customer account with verified access to ordering, delivery tracking, support, and saved preferences.' : roleCopy.intro}>
    <SignInLinks />
    <SignOutNotice />
    <section className={`auth-layout auth-layout-${portalRole.toLowerCase()}`}>
      <div className="partner-cta"><div className="auth-emblem" aria-hidden="true"><ShieldCheck size={56} strokeWidth={2.5} /></div><span className="section-kicker">{portalRole === 'CUSTOMER' ? 'DOORSTEP CUSTOMER' : portalRole === 'RESTAURANT' ? 'APPROVED PARTNER WORKSPACE' : 'APPROVED RIDER WORKSPACE'}</span><h2>{roleCopy.heading}</h2><p>{roleCopy.detail}</p><div className="auth-trust-points"><span><Check size={13} /> Secure sessions</span><span><Check size={13} /> Role-checked access</span><span><Check size={13} /> Support when needed</span></div></div>
      <div className="auth-form-stack">
      <form className="auth-form" onSubmit={submit}>
        <h2>{register ? 'Customer account' : 'Sign in securely'}</h2>
        {register && <div className="form-row"><label>First name<input required name="firstName" /></label><label>Last name<input required name="lastName" /></label></div>}
        <label>Email address<input required type="email" name="email" autoComplete="username" /></label>
        {register && <label>Phone number<input required type="tel" name="phone" /></label>}
        <PasswordField required label="Password" minLength="8" name="password" autoComplete={register ? 'new-password' : 'current-password'} />
        {register && <label className="terms-check"><input type="checkbox" required /> I agree to the DOORSTEP terms and privacy policy.</label>}
        {error && <div className="admin-login-error" role="alert">{error}</div>}
        <button className="checkout-button" disabled={busy} type="submit">{busy ? 'Please wait...' : register ? 'Create account' : `Continue to ${portalRole === 'CUSTOMER' ? 'DOORSTEP' : portalRole === 'RESTAURANT' ? 'owner workspace' : 'rider workspace'}`} <ArrowRight size={17} /></button>
        {!register && <button className="forgot-password-link" type="button" onClick={() => navigate('/forgot-password')}>Forgot password?</button>}
        <p className="form-footnote">{register ? 'Already have an account? ' : 'Need an account? '}<button type="button" onClick={() => navigate(register ? '/login' : registrationPath)}>{register ? 'Log in' : 'Register'}</button></p>
        {portalRole !== 'CUSTOMER' && <a className="forgot-password-link" href={portalRole === 'RIDER' ? '/rider/application-status' : '/partner/application-status'}>Check application status</a>}
      </form>
      {portalRole === 'CUSTOMER' && <AlternativeSignIn register={register} />}
      </div>
    </section>
  </PageFrame>
}

function RegistrationPage() {
  const [role, setRole] = useState('customer')
  const partnerCopy = role === 'restaurant' ? { title: 'Restaurant partner onboarding', label: 'restaurant', path: '/partners/restaurants/register' } : role === 'grocery' ? { title: 'Grocery Owner onboarding', label: 'grocery store', path: '/partners/groceries/register' } : { title: 'Rider onboarding', label: 'rider', path: '/riders/register' }
  return <PageFrame eyebrow="JOIN DOORSTEP" title="Choose your DOORSTEP account." intro="A quick, guided setup gets you from signup to your next order, grocery-store or restaurant review, or rider approval."><section className="registration-choice"><button className={role === 'customer' ? 'role-card selected' : 'role-card'} onClick={() => setRole('customer')}><Utensils size={25} /><strong>I’m ordering food or groceries</strong><span>Verify your details, then start ordering.</span></button><button className={role === 'restaurant' ? 'role-card selected' : 'role-card'} onClick={() => setRole('restaurant')}><Store size={25} /><strong>I own a restaurant</strong><span>Share business details for a fast review.</span></button><button className={role === 'grocery' ? 'role-card selected' : 'role-card'} onClick={() => setRole('grocery')}><Store size={25} /><strong>I own a grocery store</strong><span>List essentials and manage a live store after approval.</span></button><button className={role === 'rider' ? 'role-card selected' : 'role-card'} onClick={() => setRole('rider')}><Truck size={25} /><strong>I want to deliver</strong><span>Complete identity and vehicle checks.</span></button>{role === 'customer' ? <OnboardingCustomerRegistration /> : <div className="registration-action"><h2>{partnerCopy.title}</h2><p>A short, step-by-step application keeps every review detail clear and complete.</p><button className="checkout-button" onClick={() => navigate(partnerCopy.path)}>Start {partnerCopy.label} application <ArrowRight size={17} /></button></div>}</section></PageFrame>
}

const onboardingSteps = {
  customer: ['Your details', 'Verify email', 'Ready to order'],
  restaurant: ['Business', 'Details', 'Owner', 'Documents', 'Verify email', 'Review'],
  rider: ['Your profile', 'How you deliver', 'Documents', 'Verify email', 'Launch review'],
}

function OnboardingProgress({ type, current }) {
  return <ol className="onboarding-progress" aria-label={`${type} application progress`}>{onboardingSteps[type].map((label, index) => <li className={index === current ? 'active' : index < current ? 'complete' : ''} key={label}><span>{index < current ? <Check size={13} /> : index + 1}</span><small>{label}</small></li>)}</ol>
}

function validateOnboardingStep(form, step) {
  const fields = [...form.querySelectorAll(`[data-onboarding-step="${step}"] input, [data-onboarding-step="${step}"] select, [data-onboarding-step="${step}"] textarea`)]
  return fields.every((field) => field.checkValidity() || (field.reportValidity(), false))
}

const weekDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

function OpeningDaysField() {
  return <fieldset className="opening-days-field"><legend>Opening days</legend><div>{weekDays.map((day) => <label key={day}><input type="checkbox" name="openingDays" value={day} defaultChecked />{day.charAt(0) + day.slice(1).toLowerCase()}</label>)}</div></fieldset>
}

const registrationErrors = { ACCOUNT_ALREADY_EXISTS: 'An account with this email or phone number already exists. Log in instead, or reset your password.', ACCOUNT_VERIFICATION_REQUIRED: 'Your verification code has expired or was already used. Request a new code.', INVALID_REGISTRATION: 'Check your details: names are required and the password needs 10+ characters with upper and lower case letters and a number.' }

function readPhoneHandoff() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PHONE_HANDOFF_KEY) || 'null')
    return value && Date.now() - value.at < 9 * 60_000 ? value : null
  } catch { return null }
}

function OnboardingCustomerRegistration() {
  const providers = useAuthProviders()
  const [handoff, setHandoff] = useState(readPhoneHandoff)
  const [step, setStep] = useState(0)
  const [challenge, setChallenge] = useState(null)
  const [registration, setRegistration] = useState(null)
  const [destination, setDestination] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const requestCode = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!validateOnboardingStep(form, 0)) return
    setBusy(true); setError('')
    const values = Object.fromEntries(new FormData(form).entries())
    if (handoff) {
      // The phone number was already confirmed with a code on the sign-in screen.
      try {
        const registerResponse = await fetch(`${apiBase}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, phone: handoff.phone, termsAccepted: true, verificationId: handoff.verificationId }) })
        const registered = await registerResponse.json().catch(() => ({}))
        if (!registerResponse.ok) {
          if (registered.error === 'ACCOUNT_VERIFICATION_REQUIRED') { sessionStorage.removeItem(PHONE_HANDOFF_KEY); setHandoff(null) }
          throw new Error(registrationErrors[registered.error] || 'Could not create your account.')
        }
        sessionStorage.removeItem(PHONE_HANDOFF_KEY)
        localStorage.setItem('doorstep-token', registered.token)
        localStorage.setItem('doorstep-role', registered.user.role)
        setStep(2)
        window.setTimeout(() => navigate('/account'), 1_200)
      } catch (registrationError) { setError(registrationError.message) } finally { setBusy(false) }
      return
    }
    const destination = values.channel === 'email' || !values.channel ? values.email : values.phone
    setDestination(destination)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20_000)
    let response
    try {
      response = await fetch(`${apiBase}/api/auth/verification/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination, channel: values.channel }), signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
    const body = await response.json().catch(() => ({}))
      if (!response.ok) {
          throw new Error(verificationErrorMessage(body.error))
      }
      setRegistration({ ...values, termsAccepted: true })
      setChallenge(body)
      setStep(1)
    } catch (requestError) {
      setError(requestError?.name === 'AbortError' ? 'Verification is taking longer than expected. Please try again.' : requestError instanceof TypeError ? 'We could not reach the verification service. Check your connection and try again.' : requestError.message)
    } finally { setBusy(false) }
  }
  const verifyAndRegister = async (event) => {
    event.preventDefault()
    const code = new FormData(event.currentTarget).get('code')
    setBusy(true); setError('')
    try {
      const verificationResponse = await fetch(`${apiBase}/api/auth/verification/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: challenge.challengeId, destination: destination, code }) })
      const verification = await verificationResponse.json()
      if (!verificationResponse.ok || !verification.verified) throw new Error('That code is invalid or expired. Request a new code and try again.')
      const registerResponse = await fetch(`${apiBase}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...registration, verificationId: challenge.challengeId }) })
      const registered = await registerResponse.json()
      if (!registerResponse.ok) throw new Error(registrationErrors[registered.error] || 'Could not create your account.')
      localStorage.setItem('doorstep-token', registered.token)
      localStorage.setItem('doorstep-role', registered.user.role)
      setStep(2)
      window.setTimeout(() => navigate('/account'), 1_200)
    } catch (registrationError) { setError(registrationError.message) } finally { setBusy(false) }
  }
  if (step === 2) return <div className="onboarding-card verification-success-screen" aria-live="polite"><OnboardingProgress type="customer" current={2} /><div className="onboarding-success"><div className="verification-success-mark"><Check size={30} /></div><span className="section-kicker">VERIFICATION SUCCESSFUL</span><h2>Your account is ready.</h2><p>Your account is verified. Taking you to your DOORSTEP account now.</p></div></div>
  if (step === 1) return <form className="auth-form onboarding-card" onSubmit={verifyAndRegister}><OnboardingProgress type="customer" current={1} /><span className="section-kicker">{registration?.channel === 'whatsapp' ? 'CHECK WHATSAPP' : registration?.channel === 'phone' ? 'CHECK YOUR MESSAGES' : 'CHECK YOUR EMAIL'}</span><h2>Enter your 6-digit code.</h2><p className="onboarding-copy">We sent a code to <strong>{destination}</strong>. It expires shortly to keep your account secure.</p><label>Verification code<input required name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" /></label>{error && <div className="admin-login-error">{error}</div>}<div className="onboarding-actions"><button className="quiet-button" type="button" onClick={() => { setError(''); setStep(0) }}>Back</button><button className="checkout-button" disabled={busy} type="submit">{busy ? 'Verifying...' : 'Verify and create account'} <Check size={17} /></button></div></form>
  return <div className="onboarding-stack"><form className="auth-form onboarding-card" onSubmit={requestCode}><OnboardingProgress type="customer" current={0} /><span className="section-kicker">CUSTOMER ACCOUNT</span><h2>Let’s get you set up.</h2><p className="onboarding-copy">A few details now make checkout and delivery effortless later.</p><div data-onboarding-step="0"><div className="form-row"><label>First name<input required name="firstName" autoComplete="given-name" /></label><label>Last name<input required name="lastName" autoComplete="family-name" /></label></div><label>Email address<input required name="email" type="email" autoComplete="email" /></label>{handoff ? <label>Phone number<input name="phone" type="tel" value={handoff.phone} readOnly /><small className="field-verified"><Check size={12} /> Verified</small></label> : <label>Phone number<input required name="phone" type="tel" pattern="\+[1-9]\d{7,14}" title="Use international format, for example +2348012345678." autoComplete="tel" /></label>}{!handoff && (providers?.phone?.sms || providers?.phone?.whatsapp) ? <label>Send verification code by<select name="channel" defaultValue="email"><option value="email">Email</option>{providers.phone.whatsapp && <option value="whatsapp">WhatsApp</option>}{providers.phone.sms && <option value="phone">SMS</option>}</select></label> : <input type="hidden" name="channel" value="email" />}<PasswordField required label="Password" name="password" minLength="10" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*" title="Use at least 10 characters with uppercase, lowercase, and a number." autoComplete="new-password" hint="At least 10 characters, including uppercase, lowercase, and a number." /><label className="terms-check"><input required name="termsAccepted" type="checkbox" /> I agree to the DOORSTEP terms and privacy policy.</label></div>{error && <div className="admin-login-error">{error}</div>}<button className="checkout-button" disabled={busy} type="submit">{busy ? (handoff ? 'Creating account...' : 'Sending...') : handoff ? 'Create account' : 'Continue'} <ArrowRight size={17} /></button></form>{!handoff && <AlternativeSignIn register />}</div>
}

function OnboardingApplication({ type }) {
  const restaurant = type === 'restaurant'
  const ownerStep = restaurant ? 2 : 1
  const documentsStep = restaurant ? 3 : 2
  const verificationStep = documentsStep + 1
  const reviewStep = verificationStep + 1
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [challenge, setChallenge] = useState(null)
  const [destination, setDestination] = useState('')
  const [verificationId, setVerificationId] = useState('')
  const [reviewItems, setReviewItems] = useState([])
  const [verified, setVerified] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  const formRef = useRef(null)
  const draftKey = `doorstep-onboarding-${type}`
  useEffect(() => {
    try {
      const draft = formRef.current && restoreApplicationDraft(formRef.current, draftKey)
      if (draft) {
        setStep(Math.max(0, Math.min(draft.step, documentsStep)))
        setDraftNotice('Your saved details were restored. Re-select any documents and verify your email again to continue.')
      }
    } catch {
      setError('We could not restore the saved application from this browser session.')
    }
  }, [draftKey, documentsStep])
  const saveAndExit = () => {
    try {
      saveApplicationDraft(formRef.current, draftKey, step, documentsStep)
      navigate('/partner/register')
    } catch {
      setError('We could not save this application in the current browser session.')
    }
  }
  const editReviewStep = (reviewStep) => {
    setError('')
    setVerificationId('')
    setChallenge(null)
    setDestination('')
    setStep(reviewStep)
  }
  const advance = (event) => {
    const form = event.currentTarget.form
    if (!validateOnboardingStep(form, step)) return
    if (restaurant && step === 1 && !validateOpeningHours(form)) return
    setError('')
    setStep((current) => current + 1)
  }
  const submit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!validateOnboardingStep(form, reviewStep)) return
    if (restaurant && !validateOpeningHours(form)) return
    setBusy(true); setError('')
    try {
      const formData = new FormData(form)
      if (formData.get('password') !== formData.get('confirmPassword')) throw new Error('The passwords do not match.')
      const response = await fetch(`${apiBase}${restaurant ? '/api/partner-applications/multipart' : '/api/rider-applications/multipart'}`, { method: 'POST', body: new FormData(form) })
      const body = await response.json()
      if (!response.ok) throw new Error(applicationSubmissionError(body, form, `Could not submit the ${restaurant ? 'restaurant' : 'rider'} application.`))
      clearApplicationDraft(draftKey)
      setSubmitted(true)
    } catch (submissionError) { setError(submissionError.message) } finally { setBusy(false) }
  }
  const requestEmailCode = async (event) => {
    const form = event.currentTarget.form
    if (!validateOnboardingStep(form, documentsStep)) return
    const email = restaurant ? new FormData(form).get('businessEmail') : new FormData(form).get('email')
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiBase}/api/auth/verification/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: email, channel: 'email' }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not send the verification code.')
      setChallenge(body); setDestination(email); setStep(verificationStep)
    } catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
  }
  const verifyEmailCode = async (event) => {
    const form = event.currentTarget.form
    const code = new FormData(form).get('verificationCode')
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiBase}/api/auth/verification/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: challenge?.challengeId, destination, code }) })
      const body = await response.json()
      if (!response.ok || !body.verified) throw new Error('The verification code is invalid or expired.')
      setVerificationId(challenge.challengeId)
      setReviewItems(getApplicationReview(form))
      setVerified(true)
      window.setTimeout(() => { setVerified(false); setStep(reviewStep) }, 1_200)
    } catch (verificationError) { setError(verificationError.message) } finally { setBusy(false) }
  }
  const title = restaurant ? 'Bring your kitchen to more tables.' : 'Move good food through Sapele.'
  const intro = restaurant ? 'A guided application captures the business details our team needs to review your restaurant.' : 'A short, mobile-friendly application captures the details needed to review your rider application.'
  if (submitted) return <PageFrame eyebrow={restaurant ? 'RESTAURANT PARTNER APPLICATION' : 'RIDER APPLICATION'} title="Application received." intro="We have everything needed to start the review."><div className="onboarding-card onboarding-success"><OnboardingProgress type={type} current={reviewStep} /><Check size={25} /><span className="section-kicker">REVIEW STARTED</span><h2>Thanks, we’re on it.</h2><p>{restaurant ? 'We will review any business and identity details you supplied before activating the partner workspace.' : 'We will review any identity, vehicle, and safety information you supplied before activating rider access.'}</p><button className="checkout-button" onClick={() => navigate(restaurant ? '/partner/application-status' : '/rider/application-status')}>Track application status <ArrowRight size={17} /></button></div></PageFrame>
  return <PageFrame eyebrow={restaurant ? 'RESTAURANT PARTNER APPLICATION' : 'RIDER APPLICATION'} title={title} intro={intro}><form ref={formRef} noValidate className="application-form onboarding-card" onSubmit={submit}><input type="hidden" name="verificationId" value={verificationId} /><OnboardingProgress type={type} current={step} />{verified && <div className="onboarding-success verification-success-screen" role="status" aria-live="polite"><div className="verification-success-mark"><Check size={30} /></div><span className="section-kicker">VERIFICATION SUCCESSFUL</span><h2>Your email is confirmed.</h2><p>Taking you to the final application review step now.</p></div>}{draftNotice && <p className="onboarding-draft-notice" role="status">{draftNotice}</p>}<p className="onboarding-draft-notice">Save and exit keeps non-secret form details in this browser tab only. Passwords, verification codes, and selected files are never saved.</p>
    <SignInLinks />
    <section hidden={step !== 0} data-onboarding-step="0"><span className="section-kicker">STEP 1 OF {onboardingSteps[type].length}</span><h2>{restaurant ? 'Tell us about the business.' : 'Start with your details.'}</h2>{restaurant ? <><div className="form-row"><label>Restaurant name<input required name="restaurantName" autoComplete="organization" /></label><label>Business category<select name="businessType" defaultValue="restaurant"><option value="restaurant">Restaurant</option><option value="cafe">Cafe</option><option value="bakery">Bakery</option><option value="fast-food">Fast food</option><option value="takeaway">Takeaway</option><option value="other">Other</option></select></label></div><BusinessRegistrationField /><div className="form-row"><label>Business phone<input required name="businessPhone" type="tel" autoComplete="tel" /></label><label>Business email<input required name="businessEmail" type="email" autoComplete="email" /></label></div><label>Full business address<input required name="address" autoComplete="street-address" /></label><input name="cityName" type="hidden" value="Sapele" /></> : <><div className="form-row"><label>Full legal name<input required name="firstName" autoComplete="given-name" /></label><label>Surname<input required name="lastName" autoComplete="family-name" /></label></div><div className="form-row"><label>Email address<input required name="email" type="email" autoComplete="email" /></label><label>Phone number<input required name="phone" type="tel" autoComplete="tel" /></label></div><label>Residential address<input required name="address" autoComplete="street-address" /></label></>}<button className="checkout-button" type="button" onClick={advance}>Continue <ArrowRight size={17} /></button></section>
    {restaurant && <section hidden={step !== 1} data-onboarding-step="1"><span className="section-kicker">STEP 2 OF 6 · BUSINESS DETAILS</span><h2>How does your restaurant operate?</h2><label>Business description<textarea name="businessDescription" maxLength="1000" rows="3" /></label><label>Cuisine or food category<input name="cuisineCategory" maxLength="100" placeholder="e.g. Nigerian, bakery, grilled food" /></label><div className="form-row"><label>Opening time<input name="openingTime" type="time" /></label><label>Closing time<input name="closingTime" type="time" /></label></div><OpeningDaysField /><div className="form-row"><label>Estimated preparation time (minutes)<input name="prepTimeMinutes" type="number" min="1" max="240" /></label><label>Minimum order (naira)<input name="minimumOrder" type="number" min="0" max="500000" step="0.01" /></label></div><label>Delivery method<select required name="deliveryPreference" defaultValue="DOORSTEP_RIDERS"><option value="DOORSTEP_RIDERS">DOORSTEP riders</option><option value="OWN_RIDERS">Our own business riders</option><option value="BOTH">Both options</option></select></label><div className="onboarding-actions"><button className="quiet-button" type="button" onClick={() => setStep(0)}>Back</button><button className="checkout-button" type="button" onClick={advance}>Continue <ArrowRight size={17} /></button></div></section>}
    <section hidden={step !== ownerStep} data-onboarding-step={ownerStep}><span className="section-kicker">STEP {ownerStep + 1} OF {onboardingSteps[type].length}</span><h2>{restaurant ? 'Who owns the business?' : 'How will you deliver?'}</h2>{restaurant ? <><label>Contact person’s full name<input required name="ownerName" autoComplete="name" /></label><label>WhatsApp number (optional)<input name="whatsApp" type="tel" autoComplete="tel" /></label></> : <><p className="onboarding-copy">This application joins the independent DOORSTEP rider pool. Approved businesses can assign eligible riders to their own team.</p><label>Preferred operating area<input required name="preferredArea" maxLength="160" placeholder="Town, neighbourhood, or delivery zone" /></label><div className="form-row"><label>Vehicle type<select required name="vehicleType" defaultValue=""><option value="">Choose a vehicle</option><option value="bicycle">Bicycle</option><option value="motorcycle">Motorcycle</option><option value="car">Car</option><option value="other">Other approved vehicle</option></select></label><label>Vehicle registration (if applicable)<input name="vehicleRegistration" maxLength="100" /></label></div><label>Vehicle access<select required name="vehicleOwnership" defaultValue=""><option value="">Choose one</option><option value="OWNED">I own this vehicle</option><option value="PERMITTED">I have permission to use it</option></select></label><label>Typical availability<input required name="typicalAvailability" maxLength="120" placeholder="e.g. Weekdays, 4 pm–10 pm" /></label><label>Preferred language (optional)<input name="preferredLanguage" maxLength="60" /></label><div className="form-row"><label>Emergency contact name (optional)<input name="emergencyName" maxLength="120" /></label><label>Emergency contact phone (optional)<input name="emergencyPhone" type="tel" maxLength="30" /></label></div></>}<div className="onboarding-actions"><button className="quiet-button" type="button" onClick={() => setStep(0)}>Back</button><button className="checkout-button" type="button" onClick={advance}>Continue <ArrowRight size={17} /></button></div></section>
    {restaurant && <section hidden={step !== 2} data-onboarding-step="2"><span className="section-kicker">STEP 3 OF 6 · OWNER DETAILS</span><h2>How can we verify the owner?</h2><p className="onboarding-copy">Provide identity details only if available; our review team may request documents later.</p><label>Identity type (optional)<select name="ownerIdentityType" defaultValue=""><option value="">Prefer not to say</option><option value="national-id">National ID</option><option value="drivers-license">Driver’s licence</option><option value="passport">Passport</option></select></label><label>Identity number (optional)<input name="ownerIdentityNumber" maxLength="120" /></label><div className="onboarding-actions"><button className="quiet-button" type="button" onClick={() => setStep(1)}>Back</button><button className="checkout-button" type="button" onClick={advance}>Continue <ArrowRight size={17} /></button></div></section>}
    <section hidden={step !== documentsStep} data-onboarding-step={documentsStep}><span className="section-kicker">STEP {documentsStep + 1} OF {onboardingSteps[type].length} · DOCUMENTS</span><h2>Documents (optional).</h2><p className="onboarding-copy">{restaurant ? 'Share a logo, storefront photo, menu, or relevant business document. Only PDF, JPEG, or PNG files up to 5 MB are accepted.' : 'Identity documents help verify your account. A driving licence and vehicle documents may be needed for motorized vehicles; explain questions can be sent before approval.'} Files are private and reviewed by authorised staff.</p>{!restaurant && <><label>Identity type (optional)<select name="identityType" defaultValue=""><option value="">Prefer not to say</option><option value="national-id">National ID</option><option value="drivers-license">Driver’s licence</option><option value="passport">Passport</option></select></label><label>Identity number (optional)<input name="identityNumber" maxLength="120" /></label><label className="terms-check"><input type="checkbox" name="identityCheckConsent" value="true" /> I agree that DOORSTEP may check my ID number and name against official records through its identity-verification partner. Only a match result is kept.</label></>}<label>{restaurant ? 'Business documents and photos (optional)' : 'Identity, licence, and vehicle documents (optional)'}<input name="documents" type="file" accept="image/jpeg,image/png,application/pdf" multiple /></label><small>Up to five files, each no larger than 5 MB.</small>{error && <div className="admin-login-error">{error}</div>}<div className="onboarding-actions"><button className="quiet-button" type="button" onClick={() => setStep(documentsStep - 1)}>Back</button><button className="checkout-button" disabled={busy} type="button" onClick={requestEmailCode}>{busy ? 'Sending...' : 'Verify email'} <ArrowRight size={17} /></button></div></section>
    <section hidden={step !== verificationStep || verified} data-onboarding-step={verificationStep}><span className="section-kicker">STEP {verificationStep + 1} OF {onboardingSteps[type].length} · VERIFY EMAIL</span><h2>Verify your email.</h2><p className="onboarding-copy">We sent a 6-digit code to <strong>{destination}</strong>. Enter it before submitting the application.</p><label>Email verification code<input required name="verificationCode" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" /></label>{error && <div className="admin-login-error">{error}</div>}<div className="onboarding-actions"><button className="quiet-button" type="button" onClick={() => setStep(documentsStep)}>Back</button><button className="checkout-button" disabled={busy} type="button" onClick={verifyEmailCode}>{busy ? 'Verifying...' : 'Confirm code'} <ArrowRight size={17} /></button></div></section>
    <section hidden={step !== reviewStep} data-onboarding-step={reviewStep}><span className="section-kicker">STEP {reviewStep + 1} OF {onboardingSteps[type].length} · REVIEW</span><h2>Review and submit.</h2><p className="onboarding-copy">Check your application. Your workspace stays pending until DOORSTEP approves it.</p><ApplicationReviewSummary items={reviewItems} onEdit={editReviewStep} /><PasswordField required label="Workspace password" name="password" minLength="8" autoComplete="new-password" /><PasswordField required label="Confirm workspace password" name="confirmPassword" minLength="8" autoComplete="new-password" /><label className="terms-check"><input required name="termsAccepted" type="checkbox" /> I confirm these details are accurate and agree to the applicable DOORSTEP terms and privacy policy.</label>{error && <div className="admin-login-error">{error}</div>}<div className="onboarding-actions"><button className="quiet-button" type="button" onClick={() => setStep(verificationStep)}>Back</button><button className="checkout-button" disabled={busy} type="submit">{busy ? 'Submitting...' : 'Submit application'} <ArrowRight size={17} /></button></div></section>
    <button className="quiet-button onboarding-save-exit" type="button" onClick={saveAndExit}>Save and exit</button>
  </form></PageFrame>
}

function OnboardingPartnerApplication() {
  return <OnboardingApplication type="restaurant" />
}

function OnboardingRiderApplication() {
  return <OnboardingApplication type="rider" />
}

function VerifiedCustomerRegistration() {
  const [step, setStep] = useState('details')
  const [challenge, setChallenge] = useState(null)
  const [destination, setDestination] = useState('')
  const [registration, setRegistration] = useState(null)
  const [error, setError] = useState('')
  const requestCode = async (event) => {
    event.preventDefault(); setError('')
    const form = new FormData(event.currentTarget); const email = form.get('email'); setDestination(email); setRegistration(Object.fromEntries(form.entries()))
    try {
      const response = await fetch(`${apiBase}/api/auth/verification/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: email, channel: 'email' }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) return setError(verificationErrorMessage(body.error))
      setChallenge(body); setStep('verify')
    } catch (requestError) {
      setError(requestError instanceof TypeError ? 'We could not reach the verification service. Check your connection and try again.' : requestError.message)
    }
  }
  if (step === 'verify') return <form className="auth-form verification-card" onSubmit={async (event) => { event.preventDefault(); const code = new FormData(event.currentTarget).get('code'); const response = await fetch(`${apiBase}/api/auth/verification/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: challenge.challengeId, destination, code }) }); const body = await response.json(); if (!body.verified) return setError('That code is invalid or expired.'); const registerResponse = await fetch(`${apiBase}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...registration, verificationId: challenge.challengeId }) }); const registered = await registerResponse.json(); if (!registerResponse.ok) return setError(registered.error || 'Could not create account.'); localStorage.setItem('doorstep-token', registered.token); navigate('/account') }}><span className="section-kicker">CHECK YOUR EMAIL</span><h2>Enter your 6-digit code.</h2><p>We sent a verification code to {destination}. Development mode shows the code in the API terminal.</p><label>Verification code<input required name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" /></label>{error && <div className="admin-login-error">{error}</div>}<button className="checkout-button" type="submit">Verify and create account <Check size={17} /></button></form>
  return <form className="auth-form customer-register-card" onSubmit={requestCode}><span className="section-kicker">CUSTOMER ACCOUNT</span><h2>Create your account.</h2><div className="form-row"><label>First name<input required name="firstName" /></label><label>Last name<input required name="lastName" /></label></div><label>Email address<input required type="email" name="email" /></label><label>Phone number<input required type="tel" name="phone" /></label><PasswordField required label="Password" name="password" minLength="8" />{error && <div className="admin-login-error">{error}</div>}<button className="checkout-button" type="submit">Send verification code <ArrowRight size={17} /></button></form>
}

function AccountDashboard() {
  const [user, setUser] = useState(null)
  const [orders, setOrders] = useState(null)
  const [parcels, setParcels] = useState(null)
  const [addresses, setAddresses] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!localStorage.getItem('doorstep-token')) return
    const get = (path) => fetch(`${apiBase}${path}`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
    get('/api/auth/me').then((body) => setUser(body.user)).catch(() => setError('We could not load your profile. Pull to refresh or try again shortly.'))
    get('/api/orders?limit=20').then((body) => setOrders(body.orders || [])).catch(() => setOrders([]))
    get('/api/parcels?limit=20').then((body) => setParcels(body.bookings || [])).catch(() => setParcels([]))
    get('/api/addresses').then((body) => setAddresses(body.addresses || [])).catch(() => setAddresses([]))
  }, [])
  const finished = ['DELIVERED', 'CANCELLED', 'REFUNDED', 'REJECTED']
  const activeOrders = orders?.filter((order) => !finished.includes(order.status)) || []
  const activeParcels = parcels?.filter((parcel) => !finished.includes(parcel.status)) || []
  const count = (list) => list === null ? '…' : list.length
  const rows = [
    { label: 'Orders', detail: orders === null ? 'Loading…' : activeOrders.length ? `${activeOrders.length} in progress` : 'Your food and grocery orders', href: '/account/orders', icon: ShoppingBag },
    { label: 'Packages', detail: parcels === null ? 'Loading…' : activeParcels.length ? `${activeParcels.length} on the way` : 'Send and track packages', href: '/parcels', icon: Truck },
    { label: 'Addresses', detail: addresses === null ? 'Loading…' : addresses.length ? `${addresses.length} saved` : 'Save Home, Work and more', href: '/account/addresses', icon: MapPin },
    { label: 'Payment methods', detail: 'Saved debit and credit cards', href: '/account/cards', icon: CreditCard },
    { label: 'Sign-in & security', detail: 'Email, phone, password and Google', href: '/account/security', icon: ShieldCheck },
    { label: 'Favourites', detail: 'Kitchens and dishes you saved', href: '/account/favorites', icon: Star },
    { label: 'Notifications', detail: 'Order, payment and delivery updates', href: '/account/notifications', icon: Bell },
    { label: 'Help', detail: 'Chat with support or raise a ticket', href: '/account/support', icon: HelpCircle },
    { label: 'Profile and security', detail: 'Name, phone, photo and password', href: '/account/profile', icon: Settings },
  ]
  const latest = activeOrders[0]
  const latestParcel = activeParcels[0]
  return <main className="route-page account-app">
    <section className="account-app-head">
      <ProfileAvatar className="account-app-avatar" size={56} />
      <div>
        <h1>{user ? `${user.firstName} ${user.lastName}`.trim() : 'Your account'}</h1>
        <p>{user ? [user.phone, user.email].filter(Boolean).join(' · ') : error || 'Loading your profile…'}</p>
      </div>
      <button type="button" className="account-app-edit" onClick={() => navigate('/account/profile')}>Edit</button>
    </section>
    <ProfileCompletenessCard />
    <section className="account-app-stats" aria-label="Your activity">
      <button type="button" onClick={() => navigate('/account/orders')}><strong>{orders === null ? '…' : activeOrders.length}</strong><span>Active orders</span></button>
      <button type="button" onClick={() => navigate('/parcels')}><strong>{parcels === null ? '…' : activeParcels.length}</strong><span>Packages moving</span></button>
      <button type="button" onClick={() => navigate('/account/addresses')}><strong>{count(addresses)}</strong><span>Saved addresses</span></button>
    </section>
    {(latest || latestParcel) && <section className="account-app-live" aria-label="In progress">
      {latest && <button type="button" onClick={() => navigate(`/account/orders/${latest.id}`)}><Clock3 size={20} aria-hidden="true" /><span><strong>{latest.restaurant?.name || 'Your order'}</strong><small>{latest.status.replaceAll('_', ' ').toLowerCase()} · {latest.orderNumber}</small></span><ArrowRight size={18} aria-hidden="true" /></button>}
      {latestParcel && <button type="button" onClick={() => navigate(`/parcels/${latestParcel.id}`)}><Truck size={20} aria-hidden="true" /><span><strong>Package {latestParcel.reference}</strong><small>{latestParcel.statusLabel}</small></span><ArrowRight size={18} aria-hidden="true" /></button>}
    </section>}
    <nav className="account-app-list" aria-label="Account">
      {rows.map(({ label, detail, href, icon: Icon }) => <button type="button" key={href} onClick={() => navigate(href)}><span className="account-app-icon" aria-hidden="true"><Icon size={20} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={17} aria-hidden="true" /></button>)}
    </nav>
    <div className="account-app-signout"><SignOutButton /></div>
    <MobileStoreDock />
  </main>
}

function PackageIcon() { return <ShoppingBag size={24} /> }
function HeartIcon() { return <span className="account-heart">♡</span> }

const verificationErrorMessage = (code) =>
 ({  EMAIL_VERIFICATION_NOT_CONFIGURED: 'Email verification is temporarily unavailable. Please contact support or try again later.',
  EMAIL_VERIFICATION_PROVIDER_UNSUPPORTED: 'Email verification is temporarily unavailable. Please contact support or try again later.',
  EMAIL_VERIFICATION_RATE_LIMITED: 'Too many verification emails have been requested. Please wait a few minutes before trying again.',
  SMS_VERIFICATION_NOT_CONFIGURED: 'SMS verification is temporarily unavailable. Please choose email verification or try again later.',
  SMS_VERIFICATION_PROVIDER_UNSUPPORTED: 'SMS verification is temporarily unavailable. Please choose email verification or try again later.',
  SMS_VERIFICATION_RATE_LIMITED: 'Too many verification messages have been requested. Please wait a few minutes before trying again.',
  SMS_VERIFICATION_UNAVAILABLE: 'Our SMS service is temporarily unavailable. Please choose email verification or try again shortly.',
  VERIFICATION_SERVICE_UNAVAILABLE: 'Our email service is temporarily unavailable. Please try again shortly.',
  INVALID_VERIFICATION_REQUEST: 'Enter a valid email address or E.164 mobile number and try again.',
  VERIFICATION_REQUEST_RATE_LIMITED: 'Too many verification requests have been made. Please wait a few minutes before trying again.',
  RATE_LIMITED: 'Too many verification requests have been made. Please wait a few minutes before trying again.',
  VERIFICATION_COOLDOWN: 'A code was just sent. Wait a minute before asking for another one.',
  VERIFICATION_HOURLY_LIMIT: 'Too many codes have been requested for this address. Try again in an hour.',
  WHATSAPP_VERIFICATION_NOT_CONFIGURED: 'WhatsApp codes are not available yet. Choose email instead.',
  WHATSAPP_VERIFICATION_UNAVAILABLE: 'We could not send the WhatsApp message. Check the number uses WhatsApp, or choose another method.',
  WHATSAPP_VERIFICATION_RATE_LIMITED: 'Too many WhatsApp messages have been requested. Please wait a few minutes.',
}[code] || 'We could not send a verification email. Please try again.')
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('doorstep-token')}`, 'Content-Type': 'application/json' })
export function SignOutButton() { const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); return <span className="sign-out-menu"><button className="sign-out-button" type="button" aria-label="Open sign-out options" title="Open sign-out options" onClick={() => setOpen(!open)}><span className="sign-out-icon"><LogOut size={15} /></span><ArrowRight size={14} /></button>{open && <button className="sign-out-confirm" type="button" disabled={busy} onClick={() => { setBusy(true); void endSession({ apiBase }) }}>{busy ? 'Signing out...' : 'Sign out'}</button>}</span> }

const maxProfileSourceBytes = 100 * 1024 * 1024
const maxProfilePixels = 36_000_000

function ProfilePhotoCropper({ photo, onCancel, onConfirm }) {
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 })
  const [saving, setSaving] = useState(false)
  const drag = useRef(null)
  const sourceSize = Math.min(photo.image.naturalWidth, photo.image.naturalHeight)
  const cropSize = sourceSize / zoom
  const backgroundSize = `${(photo.image.naturalWidth / cropSize) * 100}% ${(photo.image.naturalHeight / cropSize) * 100}%`

  const updatePositionFromPointer = (event) => {
    if (!drag.current) return
    const { startX, startY, x, y, width, height } = drag.current
    const horizontalRange = Math.max(photo.image.naturalWidth - cropSize, 1)
    const verticalRange = Math.max(photo.image.naturalHeight - cropSize, 1)
    setPosition({
      x: Math.max(0, Math.min(1, startX - ((event.clientX - x) / width) * (cropSize / horizontalRange))),
      y: Math.max(0, Math.min(1, startY - ((event.clientY - y) / height) * (cropSize / verticalRange))),
    })
  }

  const saveCrop = () => {
    setSaving(true)
    const horizontalRange = Math.max(photo.image.naturalWidth - cropSize, 0)
    const verticalRange = Math.max(photo.image.naturalHeight - cropSize, 0)
    const canvas = document.createElement('canvas')
    canvas.width = 720
    canvas.height = 720
    canvas.getContext('2d').drawImage(photo.image, position.x * horizontalRange, position.y * verticalRange, cropSize, cropSize, 0, 0, 720, 720)
    canvas.toBlob((blob) => {
      setSaving(false)
      if (!blob) return
      onConfirm(new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  }

  return <div className="photo-cropper-backdrop" role="dialog" aria-modal="true" aria-labelledby="photo-cropper-title">
    <section className="photo-cropper">
      <div className="photo-cropper-heading"><div><span className="section-kicker">PROFILE PHOTO</span><h2 id="photo-cropper-title">Position your photo</h2></div><button className="quiet-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button></div>
      <div className="photo-crop-preview" style={{ backgroundImage: `url("${photo.url}")`, backgroundPosition: `${position.x * 100}% ${position.y * 100}%`, backgroundSize }} onPointerDown={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); drag.current = { startX: position.x, startY: position.y, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={updatePositionFromPointer} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} />
      <label className="photo-crop-zoom">Zoom<input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      <p>Drag the image to position it. Your original stays on this device; DOORSTEP uploads a cropped JPEG profile photo.</p>
      <div className="photo-cropper-actions"><button className="quiet-button" type="button" onClick={onCancel} disabled={saving}>Choose another photo</button><button className="checkout-button" type="button" onClick={saveCrop} disabled={saving}>{saving ? 'Preparing photo...' : 'Use this photo'} <Check size={17} /></button></div>
    </section>
  </div>
}

function openProfilePhotoCropper(photo, onConfirm) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const close = () => {
    root.unmount()
    host.remove()
    URL.revokeObjectURL(photo.url)
  }
  root.render(<ProfilePhotoCropper photo={photo} onCancel={close} onConfirm={(file) => {
    close()
    onConfirm(file)
  }} />)
}

function ProfilePage() {
  const [user, setUser] = useState(null)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', preferredName: '', dateOfBirth: '', dietaryPreference: '', deliveryNotes: '' })
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoUrl, setPhotoUrl] = useState(null)
  useEffect(() => { fetch(`${apiBase}/api/auth/me`, { headers: authHeaders() }).then((response) => response.json()).then((body) => { setUser(body.user); setForm({ firstName: body.user.firstName || '', lastName: body.user.lastName || '', phone: body.user.phone || '', preferredName: body.user.preferredName || '', dateOfBirth: body.user.dateOfBirth ? body.user.dateOfBirth.slice(0, 10) : '', dietaryPreference: body.user.dietaryPreference || '', deliveryNotes: body.user.deliveryNotes || '' }) }).catch(() => setMessage('Could not load your profile.')) }, [])
  useEffect(() => {
    if (!user?.profileImageKey) {
      setPhotoUrl(null)
      return undefined
    }
    let objectUrl
    let cancelled = false
    fetch(`${apiBase}/api/profile/photo`, { headers: authHeaders() })
      .then((response) => response.ok ? response.blob() : null)
      .then((photo) => {
        if (!photo || cancelled) return
        objectUrl = URL.createObjectURL(photo)
        setPhotoUrl(objectUrl)
      })
      .catch(() => setMessage('Could not load your profile photo.'))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [user?.profileImageKey])
  const updateField = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  const selectPhoto = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > maxProfileSourceBytes) {
      setMessage('Choose an image smaller than 100 MB so it can be safely prepared on this device.')
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth * image.naturalHeight > maxProfilePixels) {
        URL.revokeObjectURL(url)
        setMessage('This image has too many pixels to safely crop on this device. Choose a smaller version of the photo.')
        return
      }
      openProfilePhotoCropper({ image, url }, (croppedFile) => uploadPhoto({ target: { files: [croppedFile] } }))
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      setMessage('This device cannot prepare that image format. Choose the image from your gallery in a compatible browser.')
    }
    image.src = url
  }
  const saveProfile = async (event) => { event.preventDefault(); setSaving(true); setMessage(''); const response = await fetch(`${apiBase}/api/auth/me`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(form) }); const body = await response.json(); setSaving(false); setMessage(response.ok ? 'Your profile details have been saved.' : body.error === 'PHONE_ALREADY_IN_USE' ? 'That phone number is already linked to another account.' : body.error || 'Could not save your profile.'); if (response.ok) { setUser(body.user); window.dispatchEvent(new Event('doorstep-profile-change')) } }
    const uploadPhoto = async (event) => { const file = event.target.files?.[0]; const token = localStorage.getItem('doorstep-token'); if (!file || !token) return; setPhotoBusy(true); setMessage(''); const uploadData = new FormData(); uploadData.append('document', file); const uploadResponse = await fetch(`${apiBase}/api/uploads/private-document`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: uploadData }); const uploadBody = await uploadResponse.json(); if (!uploadResponse.ok) { setPhotoBusy(false); setMessage(uploadBody.error || 'Could not upload your profile photo.'); return } const profileResponse = await fetch(`${apiBase}/api/profile/photo`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ storageKey: uploadBody.storageKey }) }); const profileBody = await profileResponse.json(); setPhotoBusy(false); setMessage(profileResponse.ok ? 'Your profile photo has been saved.' : profileBody.error || 'Could not save your profile photo.'); if (profileResponse.ok) { setUser(profileBody.user); window.dispatchEvent(new Event('doorstep-profile-photo-change')) } }
  if (!user) return <PageFrame eyebrow="PROFILE" title="Your details" intro={message || 'Loading your profile...'}><div className="submitted-card"><Clock3 size={24} /></div></PageFrame>
  return <PageFrame eyebrow="PROFILE & SECURITY" title="Keep your details current." intro="Update your personal details whenever you need to. Your changes are saved securely to your DOORSTEP account."><section className="profile-account-layout"><div><form className="profile-edit-form" onSubmit={saveProfile}><div className="profile-edit-header"><label className="profile-photo-picker"><div className="profile-icon">{photoUrl ? <img src={photoUrl} alt="" /> : user.profileImageKey ? <Camera size={30} /> : <UserCircle size={39} />}</div><input type="file" accept="image/*" onChange={selectPhoto} disabled={photoBusy} /><span>{photoBusy ? 'Saving photo...' : 'Change photo'}</span></label><div><span className="section-kicker">CUSTOMER ACCOUNT</span><h2>{user.firstName} {user.lastName}</h2><p>{user.email}</p><small className="profile-verified"><Check size={12} /> Account active</small></div></div><ProfileCompletenessCard showWhenComplete className="profile-pc" /><div className="form-row"><label>First name<input required name="firstName" value={form.firstName} onChange={updateField} /></label><label>Last name<input required name="lastName" value={form.lastName} onChange={updateField} /></label></div><label>Email address<input disabled value={user.email} readOnly /></label><label>Phone number<input name="phone" value={form.phone} onChange={updateField} placeholder="080 0000 0000" /></label><div className="profile-extra-fields"><div className="form-row"><label>Preferred name<input name="preferredName" value={form.preferredName} onChange={updateField} placeholder="What should we call you?" /></label><label>Date of birth<input type="date" name="dateOfBirth" value={form.dateOfBirth} onChange={updateField} /></label></div><label>Dietary preference<select name="dietaryPreference" value={form.dietaryPreference} onChange={updateField}><option value="">No preference selected</option><option>No pork</option><option>Vegetarian</option><option>Vegan</option><option>Halal</option><option>Low spice</option></select></label><label>General delivery notes<textarea name="deliveryNotes" rows="3" value={form.deliveryNotes} onChange={updateField} placeholder="Helpful context for future deliveries, such as a preferred landmark." /></label></div>{message && <div className="profile-message">{message}</div>}<div className="profile-form-actions"><button className="checkout-button" type="submit" disabled={saving}>{saving ? 'Saving changes...' : 'Save changes'} <Check size={17} /></button><button className="quiet-button" type="button" onClick={() => setForm({ firstName: user.firstName || '', lastName: user.lastName || '', phone: user.phone || '', preferredName: user.preferredName || '', dateOfBirth: user.dateOfBirth ? user.dateOfBirth.slice(0, 10) : '', dietaryPreference: user.dietaryPreference || '', deliveryNotes: user.deliveryNotes || '' })}>Discard edits</button></div></form><div className="profile-security-grid"><div><ShieldCheck size={21} /><strong>Secure session</strong><small>Your account uses a revocable server session.</small><button className="quiet-button" onClick={() => navigate('/forgot-password')}>Reset password <KeyRound size={13} /></button></div><div><MapPin size={21} /><strong>Saved delivery places</strong><small>Keep addresses and landmarks ready for faster checkout.</small><button className="quiet-button" onClick={() => navigate('/account/addresses')}>Manage addresses <ArrowRight size={13} /></button></div></div></div><aside className="profile-account-menu"><span className="section-kicker">ACCOUNT CENTRE</span><h2>Your account.</h2><button onClick={() => navigate('/account/addresses')}><MapPin size={18} /><span><strong>Addresses</strong><small>Home, work, and delivery notes</small></span><ArrowRight size={14} /></button><button onClick={() => navigate('/account/favorites')}><Star size={18} /><span><strong>Favorites</strong><small>Your saved kitchens and dishes</small></span><ArrowRight size={14} /></button><button onClick={() => navigate('/account/notifications')}><Bell size={18} /><span><strong>Notifications</strong><small>Order and account updates</small></span><ArrowRight size={14} /></button><button onClick={() => navigate('/account/support')}><HelpCircle size={18} /><span><strong>Support centre</strong><small>Get help from DOORSTEP</small></span><ArrowRight size={14} /></button><button onClick={() => navigate('/forgot-password')}><Settings size={18} /><span><strong>Security settings</strong><small>Manage your password access</small></span><ArrowRight size={14} /></button></aside></section></PageFrame>
}

function AddressesPage() {
  const [addresses, setAddresses] = useState([]); const [message, setMessage] = useState(''); const [coords, setCoords] = useState(() => readConfirmedLocation() || {}); const [selectedArea, setSelectedArea] = useState('')
  const load = () => fetch(`${apiBase}/api/addresses`, { headers: authHeaders() }).then((response) => response.json()).then((body) => setAddresses(body.addresses || []))
  useEffect(() => { load(); if (new URLSearchParams(window.location.search).get('locate')) locate() }, [])
  const locate = () => navigator.geolocation?.getCurrentPosition((position) => { setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude }); setMessage('Location captured. Add a label and address, then save it.') }, () => setMessage('Location permission was not granted. You can still enter the address manually.'))
  const setDeliveryLocation = (label, coordinates = null) => {
    localStorage.setItem('doorstep-location', label)
    if (coordinates) localStorage.setItem('doorstep-location-coordinates', JSON.stringify({ ...coordinates, label }))
    else localStorage.removeItem('doorstep-location-coordinates')
    window.dispatchEvent(new Event('doorstep-location-change'))
  }
  const selectArea = (area) => {
    setSelectedArea(area)
    setDeliveryLocation(`${area}, Sapele`)
    setMessage(`${area} is now your delivery area. Add your street and landmark to save the exact address.`)
  }
  const useSavedAddress = (address) => {
    const coordinates = Number.isFinite(Number(address.latitude)) && Number.isFinite(Number(address.longitude))
      ? { latitude: Number(address.latitude), longitude: Number(address.longitude) }
      : null
    setDeliveryLocation(address.addressLine, coordinates)
    setMessage(`${address.label} is now your delivery location.`)
  }
  const save = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    const fullAddress = `${values.area}, ${values.addressLine}`
    const response = await fetch(`${apiBase}/api/addresses`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ...values, addressLine: fullAddress, latitude: coords.latitude, longitude: coords.longitude }) })
    setMessage(response.ok ? 'Delivery location saved.' : 'Could not save this address.')
    if (response.ok) {
      const coordinates = Number.isFinite(Number(coords.latitude)) && Number.isFinite(Number(coords.longitude))
        ? { latitude: Number(coords.latitude), longitude: Number(coords.longitude) }
        : null
      setDeliveryLocation(fullAddress, coordinates)
      setSelectedArea('')
      form.reset()
      load()
    }
  }
  return <PageFrame eyebrow="DELIVERY LOCATIONS" title="Your delivery addresses." intro="Choose a Sapele area, then add the exact street, house number, and landmark for reliable delivery."><section className="address-page"><div className="address-actions"><button className="primary-button" onClick={locate}><MapPin size={16} /> Use current device location</button><button className="quiet-button" type="button" onClick={() => navigate('/location?return=/account/addresses')}>Pick exact point on map <ArrowRight size={14} /></button>{coords.latitude != null && coords.longitude != null && <span>Map pin: {Number(coords.latitude).toFixed(7)}, {Number(coords.longitude).toFixed(7)}</span>}{message && <span>{message}</span>}</div><form className="address-form" onSubmit={save}><span className="section-kicker">NEW SAVED PLACE · SAPELE</span><div className="form-row"><label>Label<input required name="label" placeholder="Home, work, school..." /></label><label>Area<select required name="area" value={selectedArea} onChange={(event) => setSelectedArea(event.target.value)}><option value="" disabled>Select a Sapele area</option>{sapeleLocations.map((location) => <option key={location} value={location}>{location}</option>)}</select></label></div><label>Street, house number, or address<input required name="addressLine" placeholder="Exact street and house number" /></label><label>Landmark or delivery note<input name="landmark" placeholder="Near the pharmacy, beside the junction..." /></label><button className="checkout-button" type="submit">Save delivery location <Check size={17} /></button></form><div className="location-directory"><span className="section-kicker">DELIVERY DIRECTORY</span><h2>Sapele areas</h2><p>Select an area to use it for delivery now, then add your exact street and landmark above.</p><div>{sapeleLocations.slice(0, 12).map((location) => <button key={location} type="button" onClick={() => selectArea(location)}>{location}</button>)}</div></div><div className="address-list">{addresses.length === 0 ? <div className="empty-state">No saved locations yet.</div> : addresses.map((address) => <div className="address-card" key={address.id}><MapPin size={19} /><div><strong>{address.label}</strong><p>{address.addressLine}</p><small>{address.landmark || 'No landmark added'}</small>{address.latitude != null && address.longitude != null && <small>Pin: {Number(address.latitude).toFixed(7)}, {Number(address.longitude).toFixed(7)}</small>}</div><div className="address-card-actions"><button className="quiet-button" onClick={() => useSavedAddress(address)}>Use for delivery</button><button className="quiet-button" onClick={() => fetch(`${apiBase}/api/addresses/${address.id}`, { method: 'DELETE', headers: authHeaders() }).then(load)}>Remove</button></div></div>)}</div></section></PageFrame>
}

function LocationPage() {
  const [location, setLocation] = useState(localStorage.getItem('doorstep-location') || readConfirmedLocation()?.label || 'Amukpe, Sapele')
  const [message, setMessage] = useState('')
  const returnTo = new URLSearchParams(window.location.search).get('return')
  const saveLocation = (value, coordinates = null) => {
    localStorage.setItem('doorstep-location', value)
    if (coordinates) localStorage.setItem('doorstep-location-coordinates', JSON.stringify(coordinates))
    else localStorage.removeItem('doorstep-location-coordinates')
    window.dispatchEvent(new Event('doorstep-location-change'))
    setLocation(value)
    setMessage(`Delivering to ${value}`)
    if (coordinates && ['/', '/account/addresses', '/checkout'].includes(returnTo)) navigate(returnTo)
  }

  return <PageFrame className="location-route-page" eyebrow="DELIVERY LOCATION" title="Where should we meet you?" intro="Set a precise delivery point so your order reaches the right entrance.">
    <section className="location-page">
      <div className="location-current">
        <MapPin size={22} />
        <div>
          <span className="section-kicker">CURRENT DELIVERY LOCATION</span>
          <h2>{location}</h2>
          <p>{message || 'Used for restaurant discovery, delivery estimates, and checkout.'}</p>
        </div>
      </div>
      <Suspense fallback={mapFallback}><LocationMap onSelect={(coordinates) => saveLocation(coordinates.label || `Pinned map location · ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`, coordinates)} onCancel={() => navigate(returnTo && ['/', '/account/addresses', '/checkout'].includes(returnTo) ? returnTo : '/')} /></Suspense>
      <div className="location-directory">
        <span className="section-kicker">SAPELE DELIVERY AREAS</span>
        <h2>Choose your area</h2>
        <p>Coverage is configured by DOORSTEP operations and can expand as the service grows.</p>
        <div>{sapeleLocations.map((area) => <button key={area} onClick={() => saveLocation(`${area}, Sapele`)}>{area}</button>)}</div>
      </div>
      <button className="checkout-button" onClick={() => navigate('/account/addresses')}>Manage exact addresses <ArrowRight size={17} /></button>
    </section>
  </PageFrame>
}

function FavoritesPage() { const [favorites, setFavorites] = useState([]); useEffect(() => { fetch(`${apiBase}/api/favorites`, { headers: authHeaders() }).then((response) => response.json()).then((body) => setFavorites(body.favorites || [])) }, []); return <PageFrame eyebrow="YOUR FAVORITES" title="Your favourites." intro="The restaurants and dishes you come back to."><section className="favorites-page">{favorites.length === 0 ? <div className="notification-empty"><HeartIcon /><h2>No favourites yet.</h2><p>Tap the heart on a restaurant or food item to build your personal Sapele shortlist.</p><button className="primary-button" onClick={() => navigate('/restaurants')}>Discover restaurants <ArrowRight size={16} /></button></div> : <div className="favorite-grid">{favorites.map((favorite) => <article className="favorite-card" key={favorite.id}><div className="favorite-image" /><div><span className="section-kicker">{favorite.restaurant ? 'RESTAURANT' : 'FOOD'}</span><h2>{favorite.restaurant?.name || favorite.menuItem?.name}</h2><p>{favorite.restaurant?.description || favorite.menuItem?.description || 'Saved for your next order.'}</p></div></article>)}</div>}</section></PageFrame> }

function NotificationsPage() {
  if (!localStorage.getItem('doorstep-token')) return <PageFrame eyebrow="NOTIFICATIONS" title="Sign in to see your updates." intro="Order, delivery and payment updates appear here once you are signed in."><button className="checkout-button" onClick={() => navigate('/login?return=/account/notifications')}>Sign in</button></PageFrame>
  return <NotificationsScreen><MobileStoreDock /></NotificationsScreen>
}

function ConnectedPartnerApplication() {
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => { event.preventDefault(); setError(''); const response = await fetch(`${apiBase}/api/partner-applications/multipart`, { method: 'POST', body: new FormData(event.currentTarget) }); const body = await response.json(); if (!response.ok) return setError(body.error || 'Could not submit the restaurant application.'); setSubmitted(true) }
  if (submitted) return <PageFrame eyebrow="RESTAURANT PARTNER APPLICATION" title="Application received." intro="Your restaurant account is pending DOORSTEP review. It will remain hidden from customers until approval."><div className="submitted-card"><Check size={24} /><h2>Pending approval</h2><p>Keep your partner details ready. DOORSTEP operations will review the business and identity documents.</p><button className="primary-button" onClick={() => navigate('/')}>Back to home <ArrowRight size={16} /></button></div></PageFrame>
  return <PageFrame eyebrow="RESTAURANT PARTNER APPLICATION" title="Bring your kitchen to more tables." intro="Submit the business, owner, and private verification details required for approval."><form className="application-form" onSubmit={submit}><div className="form-row"><label>Restaurant name<input required name="restaurantName" /></label><label>Business type<select name="businessType" defaultValue="restaurant"><option value="restaurant">Restaurant</option><option value="cafe">Cafe</option><option value="bakery">Bakery</option></select></label></div><label>Registration number<input required name="registrationNumber" /></label><div className="form-row"><label>Business phone<input required name="businessPhone" inputMode="tel" /></label><label>Business email<input required name="businessEmail" type="email" /></label></div><label>Address<input required name="address" /></label><input type="hidden" name="cityName" value="Sapele" /><label>Owner full name<input required name="ownerName" /></label><div className="form-row"><label>Identity type<select required name="ownerIdentityType" defaultValue="national-id"><option value="national-id">National ID</option><option value="drivers-license">Driver’s licence</option><option value="passport">Passport</option></select></label><label>Identity number<input required name="ownerIdentityNumber" /></label></div><div className="form-row"><label>Owner identity document<input required name="documents" type="file" accept="image/jpeg,image/png,.pdf" /></label><label>Business document<input required name="documents" type="file" accept="image/jpeg,image/png,.pdf" /></label></div><PasswordField required label="Partner password" name="password" minLength="8" />{error && <div className="admin-login-error">{error}</div>}<button className="checkout-button" type="submit">Submit application <ArrowRight size={17} /></button></form></PageFrame>
}

function ConnectedRiderApplication() {
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => { event.preventDefault(); setError(''); const response = await fetch(`${apiBase}/api/rider-applications/multipart`, { method: 'POST', body: new FormData(event.currentTarget) }); const body = await response.json(); if (!response.ok) return setError(body.error || 'Could not submit the rider application.'); setSubmitted(true) }
  if (submitted) return <PageFrame eyebrow="RIDER APPLICATION" title="Application received." intro="Your rider account is pending identity, vehicle, and safety review."><div className="submitted-card"><Check size={24} /><h2>Pending approval</h2><p>You can go online only after DOORSTEP operations approves your rider record.</p><button className="primary-button" onClick={() => navigate('/')}>Back to home <ArrowRight size={16} /></button></div></PageFrame>
  return <PageFrame eyebrow="RIDER APPLICATION" title="Move good food through Sapele." intro="Submit your identity, vehicle, emergency contact, and private verification documents."><form className="application-form" onSubmit={submit}><div className="form-row"><label>First name<input required name="firstName" /></label><label>Last name<input required name="lastName" /></label></div><div className="form-row"><label>Email<input required name="email" type="email" /></label><label>Phone<input required name="phone" inputMode="tel" /></label></div><label>Home address<input required name="address" /></label><div className="form-row"><label>Identity type<select required name="identityType" defaultValue="national-id"><option value="national-id">National ID</option><option value="drivers-license">Driver’s licence</option><option value="passport">Passport</option></select></label><label>Identity number<input required name="identityNumber" /></label></div><div className="form-row"><label>Vehicle type<select required name="vehicleType" defaultValue="motorcycle"><option value="motorcycle">Motorcycle</option><option value="bicycle">Bicycle</option><option value="car">Car</option></select></label><label>Vehicle registration<input required name="vehicleRegistration" /></label></div><div className="form-row"><label>Identity document<input required name="documents" type="file" accept="image/jpeg,image/png,.pdf" /></label><label>Vehicle document<input required name="documents" type="file" accept="image/jpeg,image/png,.pdf" /></label></div><div className="form-row"><label>Emergency contact<input required name="emergencyName" /></label><label>Emergency phone<input required name="emergencyPhone" inputMode="tel" /></label></div><PasswordField required label="Password" name="password" minLength="8" />{error && <div className="admin-login-error">{error}</div>}<button className="checkout-button" type="submit">Submit application <ArrowRight size={17} /></button></form></PageFrame>
}

function PartnerPage({ register = false }) {
  const [submitted, setSubmitted] = useState(false)
  if (register) return <PageFrame eyebrow="RESTAURANT PARTNER APPLICATION" title="Bring your kitchen to more tables." intro="We verify the business and its owner before listing. Your documents stay private, and customers will not see your restaurant until it is approved.">{submitted ? <div className="submitted-card"><Check size={24} /><h2>Application submitted</h2><p>Your restaurant is marked PENDING_APPROVAL. DOORSTEP will review the business and owner identity details before it appears to customers.</p><button className="primary-button" onClick={() => navigate('/')}>Back to home <ArrowRight size={16} /></button></div> : <form className="application-form" onSubmit={(event) => { event.preventDefault(); setSubmitted(true) }}><div className="form-section-heading"><span className="section-kicker">BUSINESS DETAILS</span><p>Tell us about the kitchen customers will order from.</p></div><div className="form-row"><label>Restaurant name<input required /></label><label>Business type<select defaultValue="restaurant"><option value="restaurant">Restaurant</option><option value="cafe">Cafe</option><option value="bakery">Bakery</option></select></label></div><label>Business registration number<input required placeholder="CAC or applicable registration number" /></label><div className="form-row"><label>Business phone<input required inputMode="tel" /></label><label>Business email<input required type="email" /></label></div><label>Address and landmark<textarea required rows="3" /></label><label>Cuisine or category<input required placeholder="Nigerian food, grills, bakery..." /></label><div className="form-section-heading"><span className="section-kicker">OWNER IDENTITY</span><p>The named owner is responsible for this partner account.</p></div><label>Owner full name<input required /></label><div className="form-row"><label>Identity type<select defaultValue="national-id"><option value="national-id">National ID</option><option value="drivers-license">Driver’s licence</option><option value="passport">International passport</option></select></label><label>Identity number<input required /></label></div><div className="form-row"><label>Owner ID document<input required type="file" accept="image/*,.pdf" /></label><label>Business document<input required type="file" accept="image/*,.pdf" /></label></div><PasswordField required label="Partner login password" minLength="8" /><label className="terms-check"><input type="checkbox" required /> I confirm these details are accurate and accept partner review.</label><button className="checkout-button" type="submit">Submit partner application <ArrowRight size={17} /></button></form>}</PageFrame>
  return <PageFrame eyebrow="PARTNER WITH DOORSTEP" title="Grow your restaurant with us." intro="Reach hungry customers in Sapele with a storefront, ordering tools, and delivery coordination built around your kitchen."><section className="partner-layout"><div className="partner-benefits"><div><Store size={24} /><h2>A storefront for your kitchen</h2><p>Customers in Sapele see your menu, opening hours, and offers in one place.</p></div><div><ShieldCheck size={24} /><h2>Reviewed before listing</h2><p>Every restaurant is reviewed before it appears in the marketplace.</p></div><div><Sparkles size={24} /><h2>Orders, sales, and payouts</h2><p>Manage your menu and orders, and follow your sales and reviews from one dashboard.</p></div></div><div className="partner-cta"><span className="section-kicker">READY WHEN YOU ARE</span><h2>Let’s put your best dishes on the map.</h2><button className="primary-button" onClick={() => navigate('/partners/restaurants/register')}>Register your restaurant <ArrowRight size={17} /></button><button className="quiet-button" onClick={() => navigate('/partners/restaurants/login')}>Partner login</button></div></section></PageFrame>
}

function RiderPage({ register = false }) {
  const [submitted, setSubmitted] = useState(false)
  if (register) return <PageFrame eyebrow="RIDER APPLICATION" title="Move good food through Sapele." intro="We check your identity, vehicle, and emergency contact before you can take deliveries. You can go online once your application is approved.">{submitted ? <div className="submitted-card"><Check size={24} /><h2>Application submitted</h2><p>Your rider profile is marked PENDING_APPROVAL. You can go online only after identity and vehicle verification.</p><button className="primary-button" onClick={() => navigate('/')}>Back to home <ArrowRight size={16} /></button></div> : <form className="application-form" onSubmit={(event) => { event.preventDefault(); setSubmitted(true) }}><div className="form-section-heading"><span className="section-kicker">PERSONAL IDENTITY</span><p>This identifies the person who will deliver orders.</p></div><div className="form-row"><label>First name<input required /></label><label>Last name<input required /></label></div><div className="form-row"><label>Phone number<input required inputMode="tel" /></label><label>Email address<input required type="email" /></label></div><label>Home address<input required /></label><div className="form-row"><label>Identity type<select defaultValue="national-id"><option value="national-id">National ID</option><option value="drivers-license">Driver’s licence</option><option value="passport">International passport</option></select></label><label>Identity number<input required /></label></div><label>Identity document<input required type="file" accept="image/*,.pdf" /></label><div className="form-section-heading"><span className="section-kicker">VEHICLE & SAFETY</span><p>These details help operations assign appropriate deliveries.</p></div><div className="form-row"><label>Vehicle type<select defaultValue="motorcycle"><option value="motorcycle">Motorcycle</option><option value="bicycle">Bicycle</option><option value="car">Car</option></select></label><label>Vehicle registration<input required /></label></div><label>Vehicle document<input required type="file" accept="image/*,.pdf" /></label><div className="form-row"><label>Emergency contact name<input required /></label><label>Emergency contact phone<input required inputMode="tel" /></label></div><PasswordField required label="Rider login password" minLength="8" /><label className="terms-check"><input type="checkbox" required /> I agree to identity verification, rider safety, and rider terms.</label><button className="checkout-button" type="submit">Submit rider application <ArrowRight size={17} /></button></form>}</PageFrame>
  return <PageFrame eyebrow="RIDE WITH DOORSTEP" title="Earn by delivering locally." intro="Choose when you ride, deliver food and packages around Sapele, and get support from a local team."><section className="partner-layout"><div className="partner-benefits"><div><MapPin size={24} /><h2>Clear pickup and drop-off</h2><p>See restaurant pickup and customer destination details for each accepted delivery.</p></div><div><Truck size={24} /><h2>Ride when it suits you</h2><p>Go online when you are ready and update each delivery as you go.</p></div><div><ShieldCheck size={24} /><h2>Verified riders only</h2><p>We review every rider application before it can receive delivery requests.</p></div></div><div className="partner-cta"><span className="section-kicker">START HERE</span><h2>Ready to ride?</h2><button className="primary-button" onClick={() => navigate('/riders/register')}>Become a rider <ArrowRight size={17} /></button><button className="quiet-button" onClick={() => navigate('/riders/login')}>Rider login</button></div></section></PageFrame>
}

function TrackPage() {
  const [order, setOrder] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const searchOrder = async (event) => { event.preventDefault(); setBusy(true); setError(''); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); const response = await fetch(`${apiBase}/api/orders/track?orderNumber=${encodeURIComponent(values.orderNumber)}&phone=${encodeURIComponent(values.phone)}`); const body = await response.json(); setBusy(false); if (!response.ok) return setError(body.error === 'ORDER_NOT_FOUND' ? 'We could not find that order. Check the order number and phone number.' : body.error || 'Tracking is unavailable.'); setOrder(body.order) }
  return <PageFrame eyebrow="ORDER TRACKING" title="Know where dinner is." intro="Enter your order number and phone number to see where your order is. No sign-in needed."><form className="track-form" onSubmit={searchOrder}><label>Order number<input required name="orderNumber" placeholder="DSP-20260917-000001" /></label><label>Phone number<input required name="phone" inputMode="tel" placeholder="080 0000 0000" /></label>{error && <div className="admin-login-error">{error}</div>}<button className="checkout-button" disabled={busy} type="submit">{busy ? 'Checking order...' : 'Find my order'} <Search size={17} /></button></form>{order && <div className="track-result"><div className="status-pip">✓</div><div><span className="section-kicker">LIVE ORDER STATUS</span><h2>{order.status.replaceAll('_', ' ')}</h2><p>{order.restaurant} · {order.delivery?.status?.replaceAll('_', ' ') || 'Payment received and awaiting delivery assignment.'}</p><small>Order {order.orderNumber}</small></div></div>}</PageFrame>
}

function HelpPage() {
  const topics = ['Payment problem', 'Missing order', 'Wrong food', 'Late delivery', 'Restaurant problem', 'Rider problem', 'Account problem', 'Technical issue']
  return <PageFrame eyebrow="HELP CENTER" title="We’re here to help." intro="Find answers to common questions, or send us a message and a member of the team will reply."><section className="help-grid">{topics.map((topic) => <button key={topic} className="help-topic"><HelpCircle size={18} /><span>{topic}</span><ArrowRight size={15} /></button>)}</section><div className="support-note"><ShieldCheck size={22} /><div><h2>Support is part of the order journey.</h2><p>Payments, refunds, delivery issues, and account questions are recorded as trackable support tickets.</p></div></div></PageFrame>
}

function LegalPage({ title, intro, sections = [] }) {
  return <PageFrame eyebrow="LEGAL" title={title} intro={intro}><section className="support-page"><div className="support-guidance" style={{ maxWidth: '900px' }}>{sections.map((section) => <div key={section.heading} style={{ marginBottom: '1.4rem' }}><strong>{section.heading}</strong><p>{section.body}</p></div>)}</div></section></PageFrame>
}

function ContactPage() {
  return <PageFrame eyebrow="CONTACT US" title="Speak with DOORSTEP" intro="Questions, partnerships, or a problem with an order? Here is how to reach us."><section className="support-page"><div className="support-guidance" style={{ maxWidth: '900px' }}><div><strong>Email</strong><p>support@doorstep.example — replace with your live business inbox before launch.</p></div><div><strong>Phone</strong><p>+234 800 DOORSTEP — replace with your active business contact details.</p></div><div><strong>Business hours</strong><p>Monday to Saturday, 8:00 AM to 8:00 PM (WAT).</p></div><div><strong>Head office</strong><p>Sapele, Delta State, Nigeria.</p></div><div><strong>Partners</strong><p>restaurants@doorstep.example and riders@doorstep.example for partner onboarding and operations.</p></div></div></section></PageFrame>
}

function LinkedHelpPage() {
  const topics = [['Payment problem', 'PAYMENT'], ['Missing order', 'MISSING_ORDER'], ['Wrong food', 'WRONG_FOOD'], ['Late delivery', 'LATE_DELIVERY'], ['Restaurant problem', 'RESTAURANT'], ['Rider problem', 'RIDER'], ['Account problem', 'ACCOUNT'], ['Technical issue', 'TECHNICAL']]
  return <PageFrame eyebrow="HELP CENTER" title="We’re here to help." intro="Tell us what went wrong and we will point you to the quickest way to sort it out."><section className="help-grid">{topics.map(([label, category]) => <button key={category} className="help-topic" onClick={() => navigate(`/account/support?category=${category}`)}><HelpCircle size={18} /><span>{label}</span><ArrowRight size={15} /></button>)}</section><div className="support-note"><ShieldCheck size={22} /><div><h2>Support is part of the order journey.</h2><p>Payments, delivery issues, account questions, and missing food all become trackable support tickets.</p><button className="primary-button" onClick={() => navigate('/account/support')}>Open support center <ArrowRight size={16} /></button></div></div></PageFrame>
}

function RestaurantPage({ slug, onAddToCart, grocery = false }) {
  const [restaurant, setRestaurant] = useState(null)
  const [storeError, setStoreError] = useState('')
  const [reviews, setReviews] = useState([])
  const [reviewSummary, setReviewSummary] = useState(null)
  useEffect(() => {
    let active = true
    setRestaurant(null)
    setStoreError('')
    setReviews([])
    setReviewSummary(null)
    fetch(`${apiBase}/api/restaurants?limit=50${grocery ? '&type=GROCERY' : ''}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('The store menu is unavailable. Please try again shortly.')
        const body = await response.json()
        const store = body.restaurants?.find((item) => item.slug === slug)
        if (!store) throw new Error('This store is not currently available.')
        if (active) setRestaurant({ ...store, time: `${store.prepTimeMinutes} min preparation`, fee: 'Delivery calculated at checkout' })
      })
      .catch((error) => { if (active) setStoreError(error instanceof TypeError ? 'Unable to load the store. Check your connection and try again.' : error.message) })
    return () => { active = false }
  }, [grocery, slug])
  useEffect(() => {
    if (grocery || !restaurant) return
    let active = true
    fetch(`${apiBase}/api/restaurants/${restaurant.id}/reviews`).then((response) => response.ok ? response.json() : null).then((body) => { if (active && body) { setReviews(body.reviews || []); setReviewSummary(body.restaurant) } }).catch(() => undefined)
    return () => { active = false }
  }, [grocery, restaurant?.id])
  if (!restaurant) return <PageFrame eyebrow={grocery ? 'GROCERY STORE' : 'RESTAURANT MENU'} title={storeError ? 'Menu unavailable' : 'Loading menu…'} intro=""><p role={storeError ? 'alert' : 'status'}>{storeError || 'Loading the latest store menu.'}</p></PageFrame>
  return <PageFrame eyebrow={grocery ? 'GROCERY STORE' : 'RESTAURANT MENU'} title={restaurant.name} intro={`${restaurant.cuisine}. ${restaurant.time} delivery to Sapele with ${restaurant.fee}.`}><section className="storefront"><img className="storefront-cover" src={restaurant.image} alt={restaurant.name} /><div className="storefront-meta"><div><span className="section-kicker">OPEN NOW</span><h2>{restaurant.name}</h2><p>{restaurant.cuisine} · {reviewSummary?.ratingCount ? Number(reviewSummary.ratingAverage).toFixed(1) : restaurant.rating} rating</p></div><div className="storefront-facts"><span><Clock3 size={15} /> {restaurant.time}</span><span><MapPin size={15} /> {restaurant.fee}</span></div></div><div className="storefront-menu"><span className="section-kicker">{grocery ? 'SHOP ESSENTIALS' : 'POPULAR MENU'}</span><div className="route-menu-grid">{restaurant.items.map((item) => <article className="route-menu-item" key={item.id}><img src={item.image} alt={item.name} loading="lazy" /><div><h3>{item.name}</h3><p>{item.description}</p><strong>{formatNaira(item.price)}</strong><button className="add-button" onClick={() => onAddToCart(item, restaurant)}>Add <ArrowRight size={14} /></button></div></article>)}</div></div>{!grocery && <section className="storefront-reviews"><div className="section-heading"><div><span className="section-kicker">REVIEWS</span><h2>What customers say.</h2></div><span className="review-summary"><Star size={16} fill="currentColor" /> {reviewSummary?.ratingCount ? Number(reviewSummary.ratingAverage).toFixed(1) : restaurant.rating}</span></div>{reviews.length === 0 ? <p className="review-empty">Reviews from delivered orders will appear here.</p> : <div className="review-feed">{reviews.map((review) => <article key={review.id}><div className="review-feed-rating">{[1, 2, 3, 4, 5].map((value) => <Star key={value} size={12} fill={value <= review.rating ? 'currentColor' : 'none'} />)}</div><p>{review.body || 'A customer enjoyed this order.'}</p><small>{new Date(review.createdAt).toLocaleDateString('en-NG')}</small></article>)}</div>}</section>}</section></PageFrame>
}

function CartPage({ cart, onChangeQuantity, onCheckout }) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const delivery = cart[0]?.deliveryFee || 800
  const service = Math.round(subtotal * 0.03)
  return <PageFrame eyebrow="YOUR ORDER" title="Cart" intro="Review your items before checkout. Each order comes from one restaurant or store.">{cart.length === 0 ? <div className="submitted-card"><ShoppingBagIcon /><h2>Your cart is empty</h2><p>Choose a restaurant and add something good to get started.</p><button className="primary-button" onClick={() => navigate('/restaurants')}>Browse restaurants <ArrowRight size={16} /></button></div> : <section className="cart-page-layout"><div className="cart-page-items"><div className="cart-restaurant">{cart[0].restaurantName}<small>One kitchen per order</small></div>{cart.map((item) => <div className="cart-page-item" key={item.id}><img src={item.image} alt="" /><div><h3>{item.name}</h3><p>{formatNaira(item.price)} each</p><div className="quantity"><button onClick={() => onChangeQuantity(item.id, -1)}>-</button><span>{item.quantity}</span><button onClick={() => onChangeQuantity(item.id, 1)}>+</button></div></div><strong>{formatNaira(item.price * item.quantity)}</strong></div>)}</div><div className="cart-page-summary"><span className="section-kicker">ORDER SUMMARY</span><div><span>Subtotal</span><strong>{formatNaira(subtotal)}</strong></div><div><span>Delivery</span><strong>{formatNaira(delivery)}</strong></div><div><span>Service fee</span><strong>{formatNaira(service)}</strong></div><div className="total"><span>Total</span><strong>{formatNaira(subtotal + delivery + service)}</strong></div><button className="checkout-button" onClick={onCheckout}>Proceed to checkout <ArrowRight size={17} /></button></div></section>}</PageFrame>
}

function ShoppingBagIcon() { return <div className="success-mark"><ShoppingBag size={24} /></div> }

function CheckoutPage({ cart, onComplete, error }) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const delivery = cart[0]?.deliveryFee || 800
  const service = Math.round(subtotal * 0.03)
  const [gateway, setGateway] = useState({ provider: 'paystack', configured: false, methods: {} })
  const [paymentMethod, setPaymentMethod] = useState('PAYSTACK')
  const savedCards = useSavedCards()
  const [cardChoice, setCardChoice] = useState('NEW')
  const [saveCard, setSaveCard] = useState(false)
  useEffect(() => { const first = savedCards.cards.find((card) => !card.expired); if (first) setCardChoice((current) => current === 'NEW' ? first.id : current) }, [savedCards.cards.length])
  const [deliveryPoint, setDeliveryPoint] = useState(() => readConfirmedLocation())
  const [address, setAddress] = useState(() => readConfirmedLocation()?.label || 'Amukpe, Sapele')
  useEffect(() => {
    let active = true
    fetch(`${apiBase}/api/payments/config`).then(async (response) => {
      if (!response.ok) throw new Error('Payment methods are temporarily unavailable.')
      return response.json()
    }).then((configuration) => {
      if (!active) return
      setGateway(configuration)
      if (!configuration.methods?.paystack?.enabled && configuration.methods?.bankTransfer?.enabled) setPaymentMethod('BANK_TRANSFER')
      if (!configuration.methods?.paystack?.enabled && !configuration.methods?.bankTransfer?.enabled && configuration.methods?.cashOnDelivery?.enabled) setPaymentMethod('CASH_ON_DELIVERY')
    }).catch(() => active && setGateway({ provider: 'paystack', configured: false, methods: {} }))
    return () => { active = false }
  }, [])
  const choices = [
    { value: 'PAYSTACK', label: 'Paystack', detail: 'Secure online payment in naira', enabled: gateway.methods?.paystack?.enabled },
    { value: 'BANK_TRANSFER', label: 'Bank transfer', detail: 'Pay using a unique reference, then await verification', enabled: gateway.methods?.bankTransfer?.enabled },
    { value: 'CASH_ON_DELIVERY', label: 'Cash on delivery', detail: 'Pay the authorized delivery rider', enabled: gateway.methods?.cashOnDelivery?.enabled },
  ].filter((choice) => choice.enabled)
  const buttonLabel = paymentMethod === 'PAYSTACK' ? 'Continue to Paystack' : paymentMethod === 'BANK_TRANSFER' ? 'View transfer instructions' : 'Place cash order'
  return <PageFrame eyebrow="CHECKOUT" title="Almost at the door." intro="Confirm where we are delivering and how you would like to pay.">
    <form className="checkout-page-layout" onSubmit={onComplete}>
      <div className="checkout-details">
        <h2>Delivery details</h2>
        <label>Address<input required name="address" value={address} onChange={(event) => { setAddress(event.target.value); if (event.target.value !== deliveryPoint?.label) setDeliveryPoint(null) }} /></label>
        <button className="quiet-button" type="button" onClick={() => navigate('/location?return=/checkout')}>{deliveryPoint ? 'Adjust exact map pin' : 'Choose exact point on map'} <ArrowRight size={14} /></button>
        {deliveryPoint && <div className="checkout-location-confirmation"><MapPin size={17} /><span>Order destination: {deliveryPoint.latitude.toFixed(7)}, {deliveryPoint.longitude.toFixed(7)}</span></div>}
        <input type="hidden" name="latitude" value={deliveryPoint?.latitude ?? ''} />
        <input type="hidden" name="longitude" value={deliveryPoint?.longitude ?? ''} />
        <label>Landmark<input name="landmark" placeholder="Nearby landmark" /></label>
        <label>Delivery instructions<textarea name="instructions" rows="3" placeholder="Apartment, gate access, or rider notes" /></label>
        <label>Phone number<input required name="phone" inputMode="tel" placeholder="080 0000 0000" /></label>
        <fieldset className="payment-methods"><legend>Payment method</legend>{choices.map((choice) => <label className={paymentMethod === choice.value ? 'payment-method is-selected' : 'payment-method'} key={choice.value}><input type="radio" name="paymentMethod" value={choice.value} checked={paymentMethod === choice.value} onChange={() => setPaymentMethod(choice.value)} /><span className="payment-logo">{choice.value === 'PAYSTACK' ? 'P' : choice.value === 'BANK_TRANSFER' ? '₦' : 'C'}</span><span><strong>{choice.label}</strong><small>{choice.detail}</small></span></label>)}</fieldset>
        {paymentMethod === 'PAYSTACK' && savedCards.enabled && <SavedCardChoices cards={savedCards.cards} value={cardChoice} onChange={setCardChoice} saveCard={saveCard} onSaveCardChange={setSaveCard} enabled={savedCards.enabled} name="checkout-card" />}
        <input type="hidden" name="savedCardId" value={paymentMethod === 'PAYSTACK' && savedCards.enabled && cardChoice !== 'NEW' ? cardChoice : ''} />
        <input type="hidden" name="saveCard" value={paymentMethod === 'PAYSTACK' && savedCards.enabled && cardChoice === 'NEW' && saveCard ? 'yes' : ''} />
        {choices.length === 0 && <div className="checkout-note" role="alert"><ShieldCheck size={17} /> No payment method is currently configured. Contact DOORSTEP support.</div>}
      </div>
      <div className="cart-page-summary"><span className="section-kicker">PAYMENT SUMMARY</span><div><span>Subtotal</span><strong>{formatNaira(subtotal)}</strong></div><div><span>Delivery</span><strong>{formatNaira(delivery)}</strong></div><div><span>Service fee</span><strong>{formatNaira(service)}</strong></div><div className="total"><span>Total</span><strong>{formatNaira(subtotal + delivery + service)}</strong></div>{error && <p className="profile-message" role="alert">{error}</p>}<button className="checkout-button" type="submit" disabled={choices.length === 0}>{buttonLabel} <ArrowRight size={17} /></button><small className="payment-disclaimer">DOORSTEP recalculates this order on the server before creating a payment.</small></div>
    </form>
  </PageFrame>
}

function BankTransferPaymentPage({ orderId }) {
  const [payment, setPayment] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const load = async () => {
    const token = localStorage.getItem('doorstep-token')
    if (!token) return setError('Sign in to view this payment.')
    try {
      const response = await fetch(`${apiBase}/api/payments/orders/${orderId}/bank-transfer`, { headers: { Authorization: `Bearer ${token}` } })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not load transfer instructions.')
      setPayment(body)
      setError('')
    } catch (loadError) { setError(loadError.message) }
  }
  useEffect(() => { load() }, [orderId])
  const copy = async (label, value) => { await navigator.clipboard.writeText(value); setCopied(label) }
  if (!payment) return <PageFrame eyebrow="BANK TRANSFER" title="Loading payment instructions." intro={error || 'Getting your payment details.'}><section className="submitted-card">{error && <><p role="alert">{error}</p><button className="primary-button" onClick={load}>Try again</button></>}</section></PageFrame>
  return <PageFrame eyebrow="BANK TRANSFER" title="Complete your transfer." intro="Send the exact amount and include the reference below. We will confirm your order once we have checked the payment."><section className="submitted-card"><span className="section-kicker">{payment.orderNumber}</span><h2>{payment.status.replaceAll('_', ' ')}</h2>{payment.instructions ? <div className="bank-transfer-details"><p><strong>Bank</strong>{payment.instructions.bankName}</p><p><strong>Account name</strong>{payment.instructions.accountName}</p><p><strong>Account number</strong>{payment.instructions.accountNumber} <button type="button" className="quiet-button" onClick={() => copy('account', payment.instructions.accountNumber)}>{copied === 'account' ? 'Copied' : 'Copy'}</button></p><p><strong>Amount</strong>{formatNaira(Math.round(payment.amountMinor / 100))}</p><p><strong>Reference</strong>{payment.reference} <button type="button" className="quiet-button" onClick={() => copy('reference', payment.reference)}>{copied === 'reference' ? 'Copied' : 'Copy'}</button></p><p>{payment.instructions.message}</p>{payment.expiresAt && <p>Complete before: {new Date(payment.expiresAt).toLocaleString('en-NG')}</p>}</div> : <p>These transfer instructions are no longer available. Contact support with your order number.</p>}<div className="profile-form-actions"><button className="primary-button" onClick={load}>Check payment status</button><button className="quiet-button" onClick={() => navigate(`/account/orders/${orderId}`)}>Return to order</button></div></section></PageFrame>
}

function PaymentCallbackPage() {
  const reference = new URLSearchParams(window.location.search).get('reference') || new URLSearchParams(window.location.search).get('trxref')
  return <PageFrame eyebrow="PAYMENT STATUS" title="We’re confirming your payment." intro="Please stay on this page. Do not start a second checkout while we confirm it, or you might pay twice."><section className="submitted-card"><Clock3 size={24} /><h2>Verification in progress</h2><p>{reference ? `Payment reference: ${reference}` : 'Your payment reference is being matched to the order.'}</p><p>Once verified, your order will appear in your account history and the restaurant will be notified.</p><div className="profile-form-actions"><button className="primary-button" onClick={() => navigate('/account/orders')}>View my orders <ArrowRight size={16} /></button><button className="quiet-button" onClick={() => navigate('/help')}>Contact support</button></div></section></PageFrame>
}

function OrdersPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const token = localStorage.getItem('doorstep-token')
    if (!token) {
      setError('Sign in to view orders linked to your DOORSTEP account.')
      setLoading(false)
      return undefined
    }
    let active = true
    setLoading(true)
    setError('')
    fetch(`${apiBase}/api/orders`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'ORDER_SERVICE_UNAVAILABLE')
        if (!Array.isArray(body.orders)) throw new Error('ORDER_SERVICE_UNAVAILABLE')
        if (active) setOrders(body.orders)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'ORDER_SERVICE_UNAVAILABLE')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [refreshKey])

  return <PageFrame eyebrow="ACCOUNT ORDERS" title="Your order history." intro="Every order you have placed, with its payment and delivery status.">
    {loading ? <div className="submitted-card"><Clock3 size={24} /><h2>Loading your orders</h2><p>Checking your secure order history.</p></div>
      : error ? <div className="submitted-card"><Clock3 size={24} /><h2>Could not load orders</h2><p>{error}</p><div className="profile-form-actions"><button className="primary-button" onClick={() => setRefreshKey((key) => key + 1)}>Try again <ArrowRight size={16} /></button><button className="quiet-button" onClick={() => navigate('/help')}>Contact support</button></div></div>
        : orders.length === 0 ? <div className="submitted-card"><Clock3 size={24} /><h2>No orders yet</h2><p>Your orders will appear here with their verified payment and delivery history.</p><button className="primary-button" onClick={() => navigate('/restaurants')}>Find food <ArrowRight size={16} /></button></div>
          : <div className="orders-list">{orders.map((order) => <article className="order-row order-row-card" key={order.id}><button type="button" className="order-row-main" onClick={() => navigate(`/account/orders/${order.id}`)}><div><span className="section-kicker">{order.orderNumber}</span><h2>{order.restaurant?.name || order.restaurantName}</h2><p>{order.items?.length || 0} item(s) · {new Date(order.createdAt).toLocaleDateString('en-NG')}</p></div><div><strong>{formatNaira(order.total || (order.totalMinor ? Math.round(order.totalMinor / 100) : 0))}</strong><span className={`order-status tone-${orderStatusTone(order.status)}`}>{ORDER_STATUS_LABELS[order.status] || order.status}</span></div><ArrowRight size={16} /></button><OrderActionButtons order={order} compact onChanged={() => setRefreshKey((key) => key + 1)} /></article>)}</div>}
  </PageFrame>
}

const useCustomerDeliveryTracking = useDeliveryTracking

function OrderPage({ orderId }) {
  const [apiOrder, setApiOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [rating, setRating] = useState(5)
  const [reviewBody, setReviewBody] = useState('')
  const [reviewMessage, setReviewMessage] = useState('')
  useEffect(() => {
    const token = localStorage.getItem('doorstep-token')
    if (!token) {
      setError('Sign in to view an order linked to your DOORSTEP account.')
      setLoading(false)
      return undefined
    }
    let active = true
    let timer
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const response = await fetch(`${apiBase}/api/orders/${orderId}/tracking`, { headers: { Authorization: `Bearer ${token}` } })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'TRACKING_SERVICE_UNAVAILABLE')
        if (!body.order) throw new Error('TRACKING_SERVICE_UNAVAILABLE')
        if (active) {
          setApiOrder(body.order)
          setError('')
        }
      } catch (requestError) {
        if (active) setError(requestError.message || 'TRACKING_SERVICE_UNAVAILABLE')
      } finally {
        if (active) setLoading(false)
      }
    }
    const start = () => { load(); window.clearInterval(timer); timer = window.setInterval(load, 15000) }
    const stop = () => window.clearInterval(timer)
    start()
    document.addEventListener('visibilitychange', start)
    return () => { active = false; stop(); document.removeEventListener('visibilitychange', start) }
  }, [orderId, refreshKey])
  const tracking = useCustomerDeliveryTracking(apiOrder?.delivery?.id)
  const order = apiOrder
  if (!order) return <PageFrame eyebrow="ORDER TRACKING" title={loading ? 'Loading your order.' : 'Order details unavailable.'} intro={loading ? 'Fetching your order.' : error}><section className="submitted-card"><Clock3 size={24} /><h2>{loading ? 'Retrieving order status' : 'This order is not available'}</h2><p>{error || 'Only orders stored in your DOORSTEP account can be tracked here.'}</p><div className="profile-form-actions">{!loading && <button className="primary-button" onClick={() => setRefreshKey((key) => key + 1)}>Try again <ArrowRight size={16} /></button>}<button className="quiet-button" onClick={() => navigate(localStorage.getItem('doorstep-token') ? '/account/orders' : '/login')}>{localStorage.getItem('doorstep-token') ? 'View my orders' : 'Sign in'}</button></div></section></PageFrame>
  const currentStatus = apiOrder?.status || order.status
  const allStages = ['PAID', 'RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']
  const stages = allStages.includes(currentStatus) ? allStages : []
  const currentApiStage = stages.indexOf(currentStatus)
  const total = order.total || (order.totalMinor ? Math.round(order.totalMinor / 100) : 0)
  const submitReview = async (event) => {
    event.preventDefault()
    setReviewMessage('')
    const token = localStorage.getItem('doorstep-token')
    try {
      const response = await fetch(`${apiBase}/api/reviews`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, rating, body: reviewBody || undefined }) })
      const body = await response.json()
      setReviewMessage(response.ok ? 'Thanks. Your review helps the next customer choose well.' : body.error === 'ORDER_ALREADY_REVIEWED' ? 'You already reviewed this order.' : body.error || 'Could not save your review.')
    } catch {
      setReviewMessage('Could not reach DOORSTEP. Check your connection and try again.')
    }
  }
  return <PageFrame eyebrow="ORDER TRACKING" title={order.orderNumber} intro={`${order.restaurant || order.restaurantName} · ${order.address || 'Delivery address on file'}`}>
    {order.actions && <OrderActionButtons order={{ ...order, restaurant: { name: order.restaurant } }} onChanged={(done) => done === 'remove' ? navigate('/account/orders') : setRefreshKey((key) => key + 1)} />}
    {error && <div className="profile-message">Status refresh failed: {error}. Showing the last server-confirmed status.</div>}
    {stages.length === 0 && <div className="submitted-card"><Clock3 size={24} /><h2>{currentStatus === 'PENDING_PAYMENT' ? 'Payment verification pending' : `Order status: ${currentStatus}`}</h2><p>{currentStatus === 'PENDING_PAYMENT' ? 'The restaurant will receive this order after the payment provider confirms your payment.' : 'Delivery tracking is not available for this order status.'}</p></div>}
    {stages.length > 0 && <section className="order-page-layout"><div className="order-timeline">{stages.map((stage, index) => { const complete = currentApiStage >= 0 && index <= currentApiStage; return <div className={complete ? 'timeline-step complete' : 'timeline-step'} key={stage}><span>{complete ? '✓' : index + 1}</span><div><strong>{stage.replaceAll('_', ' ')}</strong><small>{index === 0 ? 'Payment confirmed by the server.' : 'This stage updates from the restaurant, rider, and DOORSTEP operations API.'}</small></div></div> })}</div><div className="cart-page-summary"><span className="section-kicker">ORDER SUMMARY</span><div><span>Restaurant</span><strong>{order.restaurant || order.restaurantName}</strong></div><div><span>Status</span><strong>{currentStatus}</strong></div><div><span>Payment</span><strong>{order.payment?.status || 'Unknown'}</strong></div><div className="total"><span>Total</span><strong>{formatNaira(total)}</strong></div>{apiOrder?.delivery?.rider?.callAllowed ? <a className="call-rider-button" href={`tel:${apiOrder.delivery.rider.phone}`}>Call assigned rider</a> : <small className="call-rider-note">Rider contact appears only during an active assigned delivery.</small>}<button className="checkout-button" onClick={() => navigate('/help')}>Contact support <ArrowRight size={17} /></button></div></section>}
    {tracking.snapshot && <section aria-label="Live delivery map"><Suspense fallback={mapFallback}><DeliveryTrackingMap tracking={tracking.snapshot} connection={tracking.connection} /></Suspense></section>}
    {currentStatus === 'DELIVERED' && apiOrder && <section className="review-card"><div><span className="section-kicker">TASTE NOTES</span><h2>How did {order.restaurant || order.restaurantName} do?</h2><p>Your review helps local customers find the right kitchen.</p></div><form onSubmit={submitReview}><div className="review-stars" aria-label="Choose a rating">{[1, 2, 3, 4, 5].map((value) => <button type="button" className={value <= rating ? 'is-selected' : ''} key={value} onClick={() => setRating(value)} aria-label={`${value} star${value === 1 ? '' : 's'}`}><Star size={25} fill="currentColor" /></button>)}</div><textarea value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} maxLength={2000} rows="4" placeholder="What should another Sapele customer know?" />{reviewMessage && <div className="profile-message">{reviewMessage}</div>}<button className="checkout-button" type="submit">Publish review <Sparkles size={17} /></button></form></section>}
  </PageFrame>
}

function ApplicationStatusPage({ rider = false }) {
  const [application, setApplication] = useState(null)
  // Kept in memory only, so the applicant can send documents without typing their password again.
  const credentials = useRef(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const checkStatus = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const form = event.currentTarget ? new FormData(event.currentTarget) : null
      const login = form ? { email: form.get('email'), password: form.get('password') } : credentials.current
      const response = await fetch(`${apiBase}/api/application-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(login) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error === 'APPLICATION_NOT_FOUND' ? 'We could not find an application for those account details.' : body.error === 'INVALID_CREDENTIALS' ? 'Email or password is incorrect.' : body.error || 'We could not check your application right now.')
      credentials.current = login
      setApplication(body.application)
    } catch (statusError) {
      setError(statusError.message)
    } finally {
      setBusy(false)
    }
  }
  const copy = application?.status === 'APPROVED' ? 'Your application has been approved. You can now sign in to your DOORSTEP workspace.' : application?.status === 'REJECTED' ? 'Your application was not approved. Review the note below, then contact support if you need help.' : application?.status === 'SUSPENDED' ? 'Your application is currently suspended. Contact DOORSTEP support for help.' : application?.status === 'NEEDS_INFORMATION' ? 'DOORSTEP needs more information before completing the review. Follow the review note below and send what was asked for using the form underneath.' : 'Your application is in review. Check back here for status changes or a review note requesting more information.'
  return <PageFrame eyebrow={rider ? 'RIDER APPLICATION' : 'PARTNER APPLICATION'} title="Check your application status." intro="Enter the details you applied with to see where your application stands."><section className="application-status-card">{application ? <><span className={`application-status-badge ${application.status.toLowerCase()}`}>{application.status.replaceAll('_', ' ')}</span><h2>{application.type === 'RIDER' ? 'Rider application' : 'Partner application'}</h2><p>{copy}</p>{application.reviewNote && <p className="application-review-note"><strong>Review note:</strong> {application.reviewNote}</p>}{credentials.current && <ApplicationUpdates application={application} credentials={credentials.current} onSubmitted={() => checkStatus({ preventDefault() {}, currentTarget: null })} />}<small>Submitted {new Date(application.submittedAt).toLocaleDateString('en-NG')}</small>{application.history?.length > 0 && <section className="application-status-history" aria-label="Application status history"><h3>Status history</h3><ol>{application.history.map((entry, index) => <li key={`${entry.createdAt}-${index}`}><strong>{entry.status.replaceAll('_', ' ')}</strong><small>{new Date(entry.createdAt).toLocaleString('en-NG')}</small>{entry.note && <p>{entry.note}</p>}</li>)}</ol></section>}<button className="checkout-button" onClick={() => navigate(application.status === 'APPROVED' ? (rider ? '/rider/login' : '/partner/login') : '/')}>{application.status === 'APPROVED' ? 'Sign in to your workspace' : 'Return to DOORSTEP'} <ArrowRight size={17} /></button></> : <form className="auth-form" onSubmit={checkStatus}><label>Email address<input required name="email" type="email" autoComplete="username" /></label><PasswordField required label="Password" name="password" autoComplete="current-password" />{error && <div className="admin-login-error">{error}</div>}<button className="checkout-button" disabled={busy} type="submit">{busy ? 'Checking status...' : 'Check application status'} <ArrowRight size={17} /></button></form>}</section></PageFrame>
}

function PartnerRegistrationLanding() {
  const choices = [
    { icon: <Utensils size={25} />, title: 'Restaurant partner', detail: 'For restaurants, food vendors, cafes, bakeries, and takeaway businesses.', action: 'Register your restaurant', path: '/partner/register/restaurant' },
    { icon: <Store size={25} />, title: 'Grocery & supermarket', detail: 'For supermarkets, grocery stores, fruit shops, convenience stores, and approved local retail.', action: 'Register your store', path: '/partner/register/store' },
    { icon: <MapPin size={25} />, title: 'Delivery rider', detail: 'For independent riders who want to deliver eligible DOORSTEP orders.', action: 'Become a rider', path: '/rider/register' },
  ]
  return <PageFrame eyebrow="PARTNER SETUP" title="Grow your business with DOORSTEP." intro="Reach more customers, receive online orders, and grow your business with a short, guided application."><section className="partner-registration-grid">{choices.map((choice) => <article className="partner-registration-choice" key={choice.path}><span className="partner-registration-icon">{choice.icon}</span><h2>{choice.title}</h2><p>{choice.detail}</p><button className="checkout-button" onClick={() => navigate(choice.path)}>{choice.action} <ArrowRight size={17} /></button></article>)}</section><p className="partner-registration-login">Already registered? <button type="button" onClick={() => navigate('/partner/login')}>Partner sign in</button> or <button type="button" onClick={() => navigate('/rider/login')}>rider sign in</button>. <button type="button" onClick={() => navigate('/partner/application-status')}>Check an application</button>.</p></PageFrame>
}

export function RoutePage({ path, cart = [], checkoutError = '', onAddToCart = () => {}, onChangeQuantity = () => {}, onCheckout = () => {}, onComplete = () => {} }) {
  if (path === '/navigate') return <Suspense fallback={<main className="route-page" role="status">Loading DOORSTEP navigation...</main>}><NavigationPage /></Suspense>
  if (path === '/partner/register') return <PartnerRegistrationLanding />
  if (path === '/partner/register/restaurant') return <OnboardingPartnerApplication />
  if (path === '/partner/register/store') return <GroceryOwnerApplication />
  if (path === '/partner/login') return <AuthPage portalRole="RESTAURANT" />
  if (path === '/partners/groceries/login') return <AuthPage portalRole="RESTAURANT" />
  if (path === '/partner/application-status') return <ApplicationStatusPage />
  if (path === '/rider/register') return <OnboardingRiderApplication />
  if (path === '/rider/login') return <AuthPage portalRole="RIDER" />
  if (path === '/rider/application-status') return <ApplicationStatusPage rider />
  if (path.startsWith('/categories/')) { const slug = decodeURIComponent(path.split('/')[2] || ''); const category = categories.find((item) => item.name.toLowerCase().replaceAll(' ', '-') === slug); return category ? <CategoryPage category={category.name} /> : <DiscoveryPage /> }
  if (path === '/menu') return <MenuDirectoryPage />
  if (path === '/restaurants' || path === '/food') return <DiscoveryPage />
  if (path.startsWith('/restaurants/')) return <RestaurantPage slug={path.split('/')[2]} onAddToCart={onAddToCart} />
  if (path === '/groceries') return <DiscoveryPage grocery />
  if (path.startsWith('/groceries/')) return <RestaurantPage grocery slug={path.split('/')[2]} onAddToCart={onAddToCart} />
  if (path === '/markets') return <MarketBrowsePage />
  if (path === '/partners/groceries/register') return <GroceryOwnerApplication />
  if (path === '/offers') return <DiscoveryPage offers />
  if (path === '/cart') return <CartPage cart={cart} onChangeQuantity={onChangeQuantity} onCheckout={onCheckout} />
  if (path === '/checkout') return <CheckoutPage cart={cart} onComplete={onComplete} error={checkoutError} />
  if (path.startsWith('/payment/bank-transfer/')) return <BankTransferPaymentPage orderId={path.split('/').at(-1)} />
  if (path === '/payment/callback') return <Suspense fallback={<main className="route-page" role="status">Confirming payment…</main>}><PaymentResultPage /></Suspense>
  if (path === '/send' || path === '/parcels' || path.startsWith('/parcels/')) return <Suspense fallback={<main className="route-page" role="status">Loading package delivery…</main>}><ParcelRoutes path={path} /></Suspense>
  if (path === '/account/orders') return <OrdersPage />
  if (path.startsWith('/account/orders/')) return <OrderPage orderId={path.split('/')[3]} />
  if (path === '/login') return <AuthPage />
  if (path === '/register') return <RegistrationPage />
  if (path === '/account') return <AccountDashboard />
  if (path === '/account/security') return <SignInMethodsPage />
  if (path === '/account/cards') return <Suspense fallback={<main className="route-page" role="status">Loading payment methods…</main>}><PaymentMethodsPage /></Suspense>
  if (path === '/account/profile') return <ProfilePage />
  if (path === '/account/addresses') return <AddressesPage />
  if (path === '/location') return <LocationPage />
  if (path === '/account/favorites') return <FavoritesPage />
  if (path === '/account/notifications') return <NotificationsPage />
  if (path === '/account/support') return <><SupportChatPage /><MobileStoreDock /></>
  if (path === '/partners/restaurants') return <PartnerPage />
  if (path === '/partners/restaurants/register') return <OnboardingPartnerApplication />
  if (path === '/partners/restaurants/login') return <AuthPage portalRole="RESTAURANT" />
  if (path === '/riders') return <RiderPage />
  if (path === '/riders/register') return <OnboardingRiderApplication />
  if (path === '/riders/login') return <AuthPage portalRole="RIDER" />
  if (path === '/track-order') return <TrackPage />
  if (path === '/help') return <LinkedHelpPage />
  if (path === '/privacy') return <LegalPage title="Privacy policy" intro="This privacy policy is a placeholder for the business owner to finalize before launch." sections={[{ heading: 'Information we collect', body: 'We collect account details, order information, delivery details, support interactions, and technical metadata needed to operate the marketplace securely and provide customer support.' }, { heading: 'How we use it', body: 'We use this information to create and maintain accounts, process orders, verify payments, coordinate deliveries, provide customer support, and improve platform operations.' }, { heading: 'Protection', body: 'Sensitive information is protected with secure authentication, server-side validation, and controlled access for authorized staff only.' }, { heading: 'Owner note', body: 'Finalize this section with your full legal/privacy business terms before production launch.' }]} />
  if (path === '/terms') return <LegalPage title="Terms and conditions" intro="These terms are a placeholder and should be reviewed by your legal or business advisor before launch." sections={[{ heading: 'Marketplace rules', body: 'Customers, restaurants, and riders agree to use the platform in a lawful manner and follow all requirements set by DOORSTEP operations.' }, { heading: 'Orders and services', body: 'Orders are created and priced server-side. DOORSTEP may alter, delay, or refuse orders where required by safety, legal, or operational constraints.' }, { heading: 'Ownership', body: 'The platform owner administers the marketplace, partner approvals, rider onboarding, payment processing, and marketplace terms.' }, { heading: 'Owner note', body: 'Replace this placeholder with the final DOORSTEP terms before commercial launch.' }]} />
  if (path === '/refund-policy') return <LegalPage title="Refund policy" intro="Refunds are processed according to the marketplace policy and payment provider rules." sections={[{ heading: 'Eligibility', body: 'Refunds may be issued for failed payments, incorrect or missing food, failed delivery events, or other valid complaints reviewed by DOORSTEP support.' }, { heading: 'Processing', body: 'Approved refunds are handled through the configured payment provider and recorded in the order and payment audit logs.' }, { heading: 'Owner note', body: 'Add the final business refund windows, evidence requirements, and timeline before launch.' }]} />
  if (path === '/cancellation-policy') return <LegalPage title="Cancellation policy" intro="Cancellations may be allowed before restaurant acceptance or at specific stages of the order workflow." sections={[{ heading: 'Before preparation', body: 'Orders may be cancelled before the restaurant starts preparing food, subject to platform rules and payment status.' }, { heading: 'After preparation', body: 'If the kitchen has already started preparing the order, cancellation may be partial or unavailable depending on operational status.' }, { heading: 'Owner note', body: 'Replace this policy with your formal cancellation terms for restaurant, rider, and customer operations.' }]} />
  if (path === '/restaurant-partner-terms') return <LegalPage title="Restaurant partner terms" intro="This policy is for partner restaurants and outlines service expectations, approval, and operations." sections={[{ heading: 'Partner approval', body: 'All restaurants are subject to approval before being visible to customers and before receiving live orders.' }, { heading: 'Operational standards', body: 'Restaurants must maintain accurate menus, pricing, preparation times, and service quality in line with DOORSTEP standards and customer expectations.' }, { heading: 'Owner note', body: 'Add the final restaurant operating agreement before partner onboarding goes live.' }]} />
  if (path === '/rider-terms') return <LegalPage title="Rider terms" intro="This policy is for delivery partners and explains operational rules, availability, and safety expectations." sections={[{ heading: 'Approval and readiness', body: 'Riders must be approved before participating in delivery assignments and should only accept jobs they can complete safely.' }, { heading: 'Safety and professionalism', body: 'Riders must ensure responsible driving, accurate status updates, and safe handoff practices for all deliveries.' }, { heading: 'Owner note', body: 'The business owner should finalize rider service terms before approving live deliveries.' }]} />
  if (path === '/delivery-policy') return <LegalPage title="Delivery policy" intro="This delivery policy explains the service, time windows, areas, and responsibilities for food delivery operations." sections={[{ heading: 'Service areas', body: 'Delivery service is subject to approved coverage areas and may be adjusted based on route conditions, rider availability, or service capacity.' }, { heading: 'Customer obligations', body: 'Customers are responsible for providing accurate delivery addresses, contact details, and receiving orders at the delivery point.' }, { heading: 'Owner note', body: 'Add the final city-specific delivery rules before the marketplace becomes commercially active.' }]} />
  if (path === '/contact') return <ContactPage />
  if (path === '/how-it-works') return <PageFrame eyebrow="HOW IT WORKS" title="From local kitchen to doorstep." intro="Choose a restaurant, add your favourites, pay securely, and follow the order through each handoff."><section className="steps-grid">{[['01', 'Choose your food', 'Browse approved restaurants and menus serving Sapele.'], ['02', 'We coordinate', 'The restaurant prepares your order while DOORSTEP coordinates the delivery stage.'], ['03', 'Enjoy the arrival', 'Follow the order status and receive food at your chosen address.']].map(([number, heading, copy]) => <div key={number}><span>{number}</span><h2>{heading}</h2><p>{copy}</p></div>)}</section></PageFrame>
  return null
}

import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Bell, BookOpen, Bot, Camera, Check, ChevronDown, Clock3, Compass, Heart, KeyRound, LogOut, MapPin, Menu, MessageCircle, Minus, Package, Plus, Search, ShoppingBag, ShoppingBasket, Sparkles, Star, Store, UserCircle, UtensilsCrossed, X } from 'lucide-react'
import { formatNaira } from './data'
import { loadCart, saveCart } from './services/orderService'
import { MobileStoreDock, RoutePage } from './pages'
import { ForgotPasswordPage } from './accountPages'
import { ProfileAvatar } from './ProfileAvatar'
import { CookieConsent } from './CookieConsent'
import { MobileHome } from './home/MobileHome'
import { NotificationBell } from './notifications/NotificationCenter'
import { HelpChat as ChatWidget } from './support/HelpChat'
import { readConfirmedLocation } from './location'
import { accountPathFor, loginPathFor, signOut as endSession } from './services/authService'
import { apiBase } from './config/apiBase'

function AccountAccessGate({ children }) {
  const [state, setState] = useState('loading')
  useEffect(() => {
    let active = true
    fetch(`${apiBase}/api/auth/me`, { headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}` }, signal: AbortSignal.timeout(15_000) })
      .then(async response => {
        if (response.status === 401) { window.location.replace('/login'); return }
        if (!response.ok) throw new Error('Could not verify your account. Refresh to try again.')
        const body = await response.json()
        if (!body.user?.role) throw new Error('Your account could not be verified.')
        if (!active) return
        localStorage.setItem('doorstep-role', body.user.role)
        if (body.user.role !== 'CUSTOMER') { window.location.replace(body.user.role === 'ADMIN' ? '/admin/login' : accountPathFor(body.user.role)); return }
        setState('allowed')
      }).catch(error => { if (active) setState(error.name === 'TimeoutError' ? 'Account verification timed out. Refresh to try again.' : error.message) })
    return () => { active = false }
  }, [])
  return state === 'allowed' ? children : <main className="route-page"><section className="submitted-card"><h2>Checking account access</h2><p role={state === 'loading' ? 'status' : 'alert'}>{state === 'loading' ? 'Opening the correct workspace for your account...' : state}</p></section></main>
}

// Partner, rider and admin workspaces load on demand so customers never download them.
const RestaurantPortal = lazy(() => import('./portalPages').then((module) => ({ default: module.RestaurantPortal })))
const RiderPortal = lazy(() => import('./riderPages').then((module) => ({ default: module.RiderPortal })))
const AdminLogin = lazy(() => import('./adminPages').then((module) => ({ default: module.AdminLogin })))
const AdminPortal = lazy(() => import('./adminPages').then((module) => ({ default: module.AdminPortal })))
const workspaceFallback = <main className="route-page" role="status">Loading…</main>
const currentPath = () => window.location.pathname.replace(/\/$/, '') || '/'
const partnerInitials = (name = '') => name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter((word) => word && !/^the$/i.test(word)).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'D'

function HeaderSignOut() { return <button className="header-signout" aria-label="Sign out" title="Sign out" onClick={() => endSession({ apiBase })}><LogOut size={16} /></button> }

function PortalAccessGate({ role, children }) { const [state, setState] = useState('loading'); useEffect(() => { const token = localStorage.getItem('doorstep-token'); if (!token) { setState('missing'); return } fetch(`${apiBase}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => setState(body.user?.role === role ? 'allowed' : 'wrong-role')).catch(() => setState('missing')) }, [role]); if (state === 'loading') return <main className="route-page"><div className="submitted-card"><Clock3 size={24} /><h2>Checking secure access</h2><p>Verifying your DOORSTEP portal permissions.</p></div></main>; if (state === 'allowed') return children; return <div className="app-shell"><RoutePage path={state === 'wrong-role' ? '/account' : loginPathFor(window.location.pathname, role)} /></div> }


function App() {
  const [path, setPath] = useState(currentPath)
  const [search, setSearch] = useState('')
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)
  const [restaurantSlide, setRestaurantSlide] = useState(0)
  const [heroSlide, setHeroSlide] = useState(0)
  const [approvedPartners, setApprovedPartners] = useState([])
  const approvedPartnersRef = useRef([])
  approvedPartnersRef.current = approvedPartners
  const [partnerLoading, setPartnerLoading] = useState(true)
  const [partnerError, setPartnerError] = useState('')
  const restaurantRailRef = useRef(null)
  const accountMenuRef = useRef(null)
  const [cart, setCart] = useState(() => loadCart())
  const [cartOpen, setCartOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutIdempotencyKey] = useState(() => window.crypto?.randomUUID?.() || `checkout-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const [deliveryLocation, setDeliveryLocation] = useState(() => localStorage.getItem('doorstep-location') || 'Amukpe, Sapele')
  const [locationOpen, setLocationOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  useEffect(() => { const openChat = () => setChatOpen(true); window.addEventListener('doorstep-open-chat', openChat); return () => window.removeEventListener('doorstep-open-chat', openChat) }, [])
  const [hasScrolled, setHasScrolled] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [accountRole, setAccountRole] = useState(() => localStorage.getItem('doorstep-role'))

  useEffect(() => {
    const onPopState = () => setPath(currentPath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  })

  useEffect(() => {
    const updateHeaderScrollState = () => setHasScrolled(window.scrollY > 8)
    updateHeaderScrollState()
    window.addEventListener('scroll', updateHeaderScrollState, { passive: true })
    return () => window.removeEventListener('scroll', updateHeaderScrollState)
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const rotation = window.setInterval(() => setHeroSlide((current) => (current + 1) % 4), 4000)
    return () => window.clearInterval(rotation)
  }, [])

  useEffect(() => {
    let active = true
    fetch(`${apiBase}/api/restaurants?limit=50`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Approved partner listings are temporarily unavailable.')
        return response.json()
      })
      .then((body) => {
        if (!active) return
        const partners = body.restaurants || []
        setApprovedPartners(partners)
        setSelectedRestaurant((current) => current && partners.some((partner) => partner.id === current.id) ? current : partners.find((partner) => partner.type === 'RESTAURANT') || partners[0] || null)
      })
      .catch((loadError) => {
        if (active) setPartnerError(loadError.message)
      })
      .finally(() => { if (active) setPartnerLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!accountMenuOpen) return undefined
    accountMenuRef.current?.querySelector('[role="menuitem"]')?.focus()
    const closeAccountMenu = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false)
    }
    const closeOnFocus = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeAccountMenu)
    document.addEventListener('focusin', closeOnFocus)
    return () => { document.removeEventListener('pointerdown', closeAccountMenu); document.removeEventListener('focusin', closeOnFocus) }
  }, [accountMenuOpen])

  useEffect(() => {
    const onMarketplaceAction = (event) => {
      const link = event.target.closest('a[href="#all"]')
      if (link) { event.preventDefault(); window.history.pushState({}, '', '/restaurants'); setPath('/restaurants'); return }
      const element = event.target.closest('button')
      if (!element) return
      const label = element.getAttribute('aria-label') || ''
      if (label === 'Previous restaurants' || label === 'Next restaurants') { event.preventDefault(); document.querySelector('.restaurant-grid')?.scrollBy({ left: label.startsWith('Previous') ? -340 : 340, behavior: 'smooth' }); return }
      if (!label.startsWith('Save ')) return
      event.preventDefault(); event.stopPropagation(); const token = localStorage.getItem('doorstep-token'); if (!token) { window.history.pushState({}, '', '/login'); setPath('/login'); return }
      const restaurant = approvedPartnersRef.current.find((item) => item.name === label.slice(5)); if (!restaurant) return
      fetch(`${apiBase}/api/favorites`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId: restaurant.id }) }).then((response) => { if (response.ok || response.status === 409) element.classList.toggle('is-saved') }).catch(() => undefined)
    }
    document.addEventListener('click', onMarketplaceAction, true)
    return () => document.removeEventListener('click', onMarketplaceAction, true)
  }, [])

  useEffect(() => {
    const onAccountAction = (event) => {
      const element = event.target.closest('button')
      // The notification centre handles its own clicks.
      if (!element || element.closest('.nc-trigger, .nc-panel, .nc-toast')) return
      const label = element.textContent.trim()
      if (element.getAttribute('aria-label') === 'Notifications' || label === 'Edit profile' || label.includes('Addresses') || label.includes('Favorites')) {
        event.preventDefault()
        const destination = element.getAttribute('aria-label') === 'Notifications' ? '/account/notifications' : label.includes('Addresses') ? '/account/addresses' : label.includes('Favorites') ? '/account/favorites' : '/account/profile'
        window.history.pushState({}, '', destination)
        setPath(destination)
      }
      const helpCategories = { 'Payment problem': 'PAYMENT', 'Missing order': 'MISSING_ORDER', 'Wrong food': 'WRONG_FOOD', 'Late delivery': 'LATE_DELIVERY', 'Restaurant problem': 'RESTAURANT', 'Rider problem': 'RIDER', 'Account problem': 'ACCOUNT', 'Technical issue': 'TECHNICAL' }
      if (element.classList.contains('help-topic') && helpCategories[label]) { event.preventDefault(); const destination = `/account/support?category=${helpCategories[label]}`; window.history.pushState({}, '', destination); setPath('/account/support') }
    }
    document.addEventListener('click', onAccountAction)
    return () => document.removeEventListener('click', onAccountAction)
  }, [])

  useEffect(() => {
    document.querySelectorAll('.top-actions').forEach((actions) => {
      const menus = [...actions.querySelectorAll('.header-signout-menu')]
      menus.slice(1).forEach((menu) => menu.remove())
      const existing = actions.querySelector('.header-signout')
      const token = localStorage.getItem('doorstep-token')
      if (token && !existing && !actions.querySelector('.profile-button')) {
        const wrapper = document.createElement('span')
        wrapper.className = 'header-signout-menu'
        const button = document.createElement('button')
        button.className = 'header-signout'
        button.setAttribute('aria-label', 'Open sign-out options')
        button.title = 'Open sign-out options'
        button.innerHTML = '<span>↪</span>'
        const confirm = document.createElement('button')
        confirm.className = 'header-signout-confirm'
        confirm.textContent = 'Sign out'
        confirm.hidden = true
        button.onclick = () => { confirm.hidden = !confirm.hidden }
        confirm.onclick = () => { confirm.disabled = true; confirm.textContent = 'Signing out...'; void endSession({ apiBase }) }
        wrapper.append(button, confirm)
        actions.insertBefore(wrapper, actions.querySelector('.cart-button'))
      } else if (existing) existing.closest('.header-signout-menu')?.remove()
    })
    const token = localStorage.getItem('doorstep-token')
    if (token) fetch(`${apiBase}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => {
      if (!body.user) return
      localStorage.setItem('doorstep-role', body.user.role)
      setAccountRole(body.user.role)
      document.querySelectorAll('.header-profile-preview').forEach((button) => {
        const initials = `${body.user.firstName?.[0] || ''}${body.user.lastName?.[0] || ''}`.toUpperCase()
        button.innerHTML = `<span class="profile-initials">${initials}</span><span class="profile-name">${body.user.firstName || 'Account'}</span>`
        button.setAttribute('aria-label', `Open ${body.user.firstName || 'account'} profile`)
      })
    }).catch(() => undefined)
  }, [path])

  useEffect(() => {
    if (!path.startsWith('/account')) return
    const token = localStorage.getItem('doorstep-token')
    if (!token) return
    fetch(`${apiBase}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => { if (response.status === 401) { localStorage.removeItem('doorstep-token'); window.history.replaceState({}, '', '/login'); setPath('/login') } }).catch(() => undefined)
  }, [path])

  useEffect(() => {
    if (path !== '/login') return
    const form = document.querySelector('.auth-form')
    if (!form || form.querySelector('.forgot-password-link')) return
    const link = document.createElement('button')
    link.className = 'forgot-password-link'
    link.type = 'button'
    link.textContent = 'Forgot password?'
    link.onclick = () => { window.history.pushState({}, '', '/forgot-password'); setPath('/forgot-password') }
    form.append(link)
  }, [path])

  useEffect(() => { const syncLocation = () => setDeliveryLocation(localStorage.getItem('doorstep-location') || 'Amukpe, Sapele'); window.addEventListener('storage', syncLocation); window.addEventListener('doorstep-location-change', syncLocation); return () => { window.removeEventListener('storage', syncLocation); window.removeEventListener('doorstep-location-change', syncLocation) } }, [])

  const chooseLocation = (location) => { localStorage.setItem('doorstep-location', `${location}, Sapele`); window.dispatchEvent(new Event('doorstep-location-change')); setLocationOpen(false) }
  const useCurrentLocation = () => { window.history.pushState({}, '', '/location'); setPath('/location') }

  const goTo = (event, destination) => {
    if (!destination.startsWith('#')) {
      event.preventDefault()
      window.history.pushState({}, '', destination)
      setPath(destination)
      setMenuOpen(false)
    }
  }
  const navigateTo = (destination) => {
    window.history.pushState({}, '', destination)
    setPath(destination)
    setMenuOpen(false)
  }
  const openPartner = (partner) => {
    const destination = `/${partner.type === 'GROCERY' ? 'groceries' : 'restaurants'}/${partner.slug}`
    navigateTo(destination)
  }

  const navigateFromAccountMenu = (destination) => {
    setAccountMenuOpen(false)
    window.history.pushState({}, '', destination)
    setPath(destination)
  }

  const signOut = () => {
    setAccountMenuOpen(false)
    void endSession({ apiBase })
  }

  const isSignedIn = Boolean(localStorage.getItem('doorstep-token'))
  const accountItems = isSignedIn
    ? [{ label: accountRole === 'RESTAURANT' ? 'Partner account' : 'My Account', detail: accountRole === 'RESTAURANT' ? 'Your business profile and settings' : 'Your profile and account settings', icon: UserCircle, path: accountPathFor(accountRole) }, { label: 'Sign out', detail: 'Securely end your session', icon: LogOut, action: signOut }]
    : [{ label: 'Customer login', detail: 'Orders, favourites and deliveries', icon: ShoppingBag, path: '/login' }, { label: 'Partner sign in', detail: 'Restaurant and grocery workspace', icon: KeyRound, path: '/partner/login' }, { label: 'Rider sign in', detail: 'Your deliveries and earnings', icon: Compass, path: '/rider/login' }, { label: 'Create an account', detail: 'Find your place on DOORSTEP', icon: Plus, path: '/register' }]
  const handleAccountKeys = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); setAccountMenuOpen(false); accountMenuRef.current?.querySelector('.profile-button')?.focus(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!accountMenuOpen) { setAccountMenuOpen(true); return }
    const items = [...accountMenuRef.current.querySelectorAll('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  const accountControl = <div className="account-menu" ref={accountMenuRef} onKeyDown={handleAccountKeys}><button className="profile-button" id="account-menu-trigger" onClick={() => setAccountMenuOpen((open) => !open)} aria-label={isSignedIn ? 'Open My Account' : 'Open sign-in options'} aria-haspopup="menu" aria-controls={accountMenuOpen ? 'account-menu-options' : undefined} aria-expanded={accountMenuOpen}>{isSignedIn ? <ProfileAvatar size={19} /> : <UserCircle size={20} />}{isSignedIn && <><span>My Account</span><ChevronDown size={14} /></>}</button>{accountMenuOpen && <div className="account-menu-popover" id="account-menu-options" role="menu" aria-labelledby="account-menu-trigger"><div className="account-menu-heading" role="presentation"><span>YOUR DOORSTEP</span><strong>{isSignedIn ? 'Welcome back.' : 'One place. Every possibility.'}</strong></div>{accountItems.map(({ label, detail, icon: Icon, path: destination, action }) => <button key={label} type="button" role="menuitem" onClick={action || (() => navigateFromAccountMenu(destination))}><span className="account-menu-icon"><Icon size={20} strokeWidth={2.5} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={16} /></button>)}</div>}</div>

  const filteredRestaurants = useMemo(() => approvedPartners.filter((restaurant) => {
    const matchesCategory = restaurant.type === 'RESTAURANT'
    const query = search.toLowerCase()
    return matchesCategory && (!query || `${restaurant.name} ${restaurant.cuisine || restaurant.description || ''}`.toLowerCase().includes(query))
  }), [approvedPartners, search])

  const approvedGroceries = useMemo(() => approvedPartners.filter((partner) => partner.type === 'GROCERY'), [approvedPartners])

  const showRestaurantSlide = (index) => { const nextIndex = (index + filteredRestaurants.length) % Math.max(filteredRestaurants.length, 1); setRestaurantSlide(nextIndex); const restaurant = filteredRestaurants[nextIndex]; if (restaurant) setSelectedRestaurant(restaurant) }
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  const addToCart = (item, restaurantOverride = selectedRestaurant) => {
    const restaurant = restaurantOverride
    if (cart.length && cart[0].restaurantId !== restaurant.id) {
      const replace = window.confirm(`Your cart has items from ${cart[0].restaurantName}. Replace them with ${restaurant.name}?`)
      if (!replace) return
    }

    const cartItem = { ...item, restaurantId: restaurant.id, restaurantName: restaurant.name, deliveryFee: Number(String(restaurant.fee || '').replace(/[^0-9]/g, '')) || 800 }
    setCart((current) => {
      const startingCart = current.length && current[0].restaurantId !== restaurant.id ? [] : current
      const existing = startingCart.find((currentItem) => currentItem.id === item.id)
      const nextCart = existing ? startingCart.map((currentItem) => currentItem.id === item.id ? { ...currentItem, quantity: currentItem.quantity + 1 } : currentItem) : [...startingCart, { ...cartItem, quantity: 1 }]
      saveCart(nextCart)
      return nextCart
    })
  }

  const changeQuantity = (id, amount) => setCart((current) => {
    const nextCart = current.map((item) => item.id === id ? { ...item, quantity: item.quantity + amount } : item).filter((item) => item.quantity > 0)
    saveCart(nextCart)
    return nextCart
  })

  const completeOrder = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const token = localStorage.getItem('doorstep-token')
    if (!token) { setCheckoutError('Please sign in before placing a real order.'); return }
    setCheckoutError('')
    try {
      const checkoutApiBase = apiBase
      const storedLocation = readConfirmedLocation()
      const hasCoordinateFields = form.has('latitude') && form.has('longitude')
      const latitude = hasCoordinateFields ? form.get('latitude') : storedLocation?.latitude
      const longitude = hasCoordinateFields ? form.get('longitude') : storedLocation?.longitude
      const orderRequest = {
        restaurantId: String(cart[0].restaurantId),
        items: cart.map((item) => ({ menuItemId: item.id, quantity: item.quantity })),
        paymentMethod: form.get('paymentMethod'),
        addressLine: form.get('address'),
        landmark: form.get('landmark'),
        phone: form.get('phone'),
        ...(latitude !== '' && longitude !== '' && latitude != null && longitude != null ? { latitude: Number(latitude), longitude: Number(longitude) } : {}),
      }
      const orderResponse = await fetch(`${apiBase}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': checkoutIdempotencyKey, Authorization: `Bearer ${token}` }, body: JSON.stringify(orderRequest) })
      const orderBody = await orderResponse.json()
      if (!orderResponse.ok) throw new Error(orderBody.message || orderBody.error || 'Could not create your order.')
      const savedCardId = form.get('savedCardId')
      if (orderRequest.paymentMethod === 'PAYSTACK' && savedCardId) {
        // Saved card: charged on the server, then confirmed with Paystack before the order is marked paid.
        const chargeResponse = await fetch(`${checkoutApiBase}/api/payments/charge-saved-card`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ kind: 'order', id: orderBody.order.id, cardId: savedCardId }) })
        const chargeBody = await chargeResponse.json().catch(() => ({}))
        if (chargeResponse.ok && chargeBody.status === 'SUCCESSFUL') {
          saveCart([])
          setCart([])
          window.history.pushState({}, '', `/account/orders/${orderBody.order.id}`)
          setPath(`/account/orders/${orderBody.order.id}`)
          return
        }
        setCheckoutError(chargeBody.message || 'Your saved card was not charged. Continuing to Paystack instead.')
      }
      const paymentResponse = await fetch(`${checkoutApiBase}/api/payments/initialize`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ orderId: orderBody.order.id, saveCard: form.get('saveCard') === 'yes' }) })
      const paymentBody = await paymentResponse.json()
      if (!paymentResponse.ok) throw new Error(paymentBody.message || paymentBody.error || 'Could not start payment.')
      saveCart([])
      setCart([])
      if (paymentBody.method === 'BANK_TRANSFER') {
        window.history.pushState({}, '', `/payment/bank-transfer/${orderBody.order.id}`)
        setPath(`/payment/bank-transfer/${orderBody.order.id}`)
        return
      }
      window.location.assign(paymentBody.authorizationUrl)
    } catch (error) { setCheckoutError(error.message); window.alert(error.message) }
  }

  const isPublicRiderRoute = path === '/rider/login' || path === '/rider/register' || path === '/rider/application-status'
  if (path.startsWith('/restaurant/') && !localStorage.getItem('doorstep-token')) return <div className="app-shell"><RoutePage path="/partner/login" /></div>
  if (path.startsWith('/rider/') && !isPublicRiderRoute && !localStorage.getItem('doorstep-token')) return <div className="app-shell"><RoutePage path="/rider/login" /></div>
  if (path.startsWith('/restaurant/')) return <PortalAccessGate role="RESTAURANT"><Suspense fallback={workspaceFallback}><RestaurantPortal path={path} /></Suspense></PortalAccessGate>
  if (path.startsWith('/rider/') && !isPublicRiderRoute) return <PortalAccessGate role="RIDER"><Suspense fallback={workspaceFallback}><RiderPortal path={path} /></Suspense></PortalAccessGate>
  if (path === '/admin/login') return <Suspense fallback={workspaceFallback}><AdminLogin onLogin={() => { window.history.pushState({}, '', '/admin/dashboard'); setPath('/admin/dashboard') }} /></Suspense>
  if (path === '/forgot-password' || path === '/reset-password') return <ForgotPasswordPage />
  if (path === '/admin/forgot-password') return <ForgotPasswordPage loginPath="/admin/login" />
  if (path.startsWith('/admin/') && !localStorage.getItem('doorstep-admin-token')) return <Suspense fallback={workspaceFallback}><AdminLogin onLogin={() => { window.history.pushState({}, '', path); setPath(path) }} /></Suspense>
  if (path.startsWith('/admin/')) return <Suspense fallback={workspaceFallback}><AdminPortal path={path} /></Suspense>
  if (path.startsWith('/account') && !localStorage.getItem('doorstep-token')) return <div className="app-shell"><RoutePage path="/login" /></div>
  if (path === '/partner/account' || path === '/partner/profile' || path === '/partner/settings') return <PortalAccessGate role="RESTAURANT"><Suspense fallback={workspaceFallback}><RestaurantPortal path="/restaurant/profile" /></Suspense></PortalAccessGate>

  const shouldShowHeaderLocation = !isSignedIn && path === '/' && hasScrolled
  const headerClass = `${hasScrolled || path !== '/' ? 'topbar is-scrolled' : 'topbar'}${isSignedIn ? '' : ' signed-out'}${shouldShowHeaderLocation ? ' has-location-selector' : ''}`
  const headerLocationControl = shouldShowHeaderLocation && <button className="header-location-selector" type="button" onClick={() => { window.history.pushState({}, '', '/location'); setPath('/location') }} aria-label="Choose delivery address"><MapPin size={17} /><span>{deliveryLocation === 'Amukpe, Sapele' ? 'Choose delivery address' : deliveryLocation}</span><ChevronDown size={16} /></button>
  const AccountFrame = path.startsWith('/account') ? AccountAccessGate : Fragment
  if (path !== '/') return <AccountFrame><div className="app-shell"><header className={headerClass}><a className="brand" href="/" onClick={(event) => goTo(event, '/')} aria-label="DOORSTEP home"><span className="brand-mark"><Sparkles size={17} strokeWidth={2.5} /></span><span>doorstep</span></a>{headerLocationControl}{isSignedIn && <nav className={menuOpen ? 'main-nav is-open' : 'main-nav'}><a href="/restaurants" onClick={(event) => goTo(event, '/restaurants')}>Restaurants</a><a href="/groceries" onClick={(event) => goTo(event, '/groceries')}>Groceries</a><a href="/send" onClick={(event) => goTo(event, '/send')}>Send package</a><a href="/menu" onClick={(event) => goTo(event, '/menu')}>Menu</a><a href="/track-order" onClick={(event) => goTo(event, '/track-order')}>Track order</a><a href="/offers" onClick={(event) => goTo(event, '/offers')}>Offers</a><a href="/help" onClick={(event) => goTo(event, '/help')}>Help</a></nav>}<div className="top-actions">{isSignedIn && <NotificationBell className="icon-button notification" />}{accountControl}{isSignedIn && <button className="cart-button" onClick={() => { window.history.pushState({}, '', '/cart'); setPath('/cart') }}><ShoppingBag size={18} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button>}</div>{isSignedIn && <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu"><Menu size={22} /></button>}</header><RoutePage path={path} cart={cart} checkoutError={checkoutError} onAddToCart={(item, restaurant) => { addToCart(item, restaurant); setPath('/cart'); window.history.pushState({}, '', '/cart') }} onChangeQuantity={changeQuantity} onCheckout={() => { window.history.pushState({}, '', '/checkout'); setPath('/checkout') }} onComplete={completeOrder} /><CookieConsent /><ChatWidget open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} /></div></AccountFrame>

  return (
    <div className="app-shell">
      <header className={headerClass}>
        <a className="brand" href="#top" aria-label="DOORSTEP home"><span className="brand-mark"><Sparkles size={17} strokeWidth={2.5} /></span><span>doorstep</span></a>
        {headerLocationControl}
        {isSignedIn && <nav className={menuOpen ? 'main-nav is-open' : 'main-nav'}>
          <a className="active" href="/" onClick={(event) => goTo(event, '/')}>Home</a><a href="/restaurants" onClick={(event) => goTo(event, '/restaurants')}>Restaurants</a><a href="/groceries" onClick={(event) => goTo(event, '/groceries')}>Groceries</a><a href="/send" onClick={(event) => goTo(event, '/send')}>Send package</a><a href="/menu" onClick={(event) => goTo(event, '/menu')}>Menu</a><a href="/track-order" onClick={(event) => goTo(event, '/track-order')}>Track order</a><a href="/offers" onClick={(event) => goTo(event, '/offers')}>Offers</a><a href="/how-it-works" onClick={(event) => goTo(event, '/how-it-works')}>How it works</a><a href="/help" onClick={(event) => goTo(event, '/help')}>Help</a>
        </nav>}
        <div className="top-actions">{isSignedIn && <NotificationBell className="icon-button notification" />}{accountControl}{isSignedIn && <button className="cart-button" onClick={() => setCartOpen(true)}><ShoppingBag size={18} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button>}</div>
        {isSignedIn && <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu"><Menu size={22} /></button>}
      </header>
      <main id="top">
        <MobileHome deliveryLocation={deliveryLocation} search={search} onSearch={setSearch} restaurants={filteredRestaurants} groceries={approvedGroceries} loading={partnerLoading} error={partnerError} onOpenPartner={openPartner} onNavigate={navigateTo} cartCount={cartCount} cartTotalLabel={formatNaira(subtotal)} onOpenCart={() => setCartOpen(true)} />
        <section className="hero-section">
          <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> Sapele, Delta State</div><h1>Food, groceries,<br /><em>closer</em> to home.</h1><p>Order meals, groceries, and everyday essentials from shops and kitchens in Sapele, delivered to your door by local riders.</p>{(!hasScrolled || isSignedIn) && <div className="search-wrap hero-location-box"><MapPin size={20} /><input readOnly value={deliveryLocation === 'Amukpe, Sapele' ? '' : deliveryLocation} onClick={() => { window.history.pushState({}, '', '/location'); setPath('/location') }} placeholder="What's your delivery address?" aria-label="Choose delivery address" /><button className="hero-current-location" aria-label="Use current location" onClick={useCurrentLocation}><Compass size={19} /></button><button aria-label="Choose delivery location" onClick={() => { window.history.pushState({}, '', '/location'); setPath('/location') }}><ArrowRight size={20} /></button></div>}</div>
          <div className="hero-art"><div className="hero-image-wrap hero-delivery-montage" aria-label="Food, grocery, and rider delivery display"><img className={heroSlide === 0 ? 'hero-slide hero-slide-food is-active' : 'hero-slide hero-slide-food'} src="https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=90" alt="A vibrant Nigerian meal in a serving bowl" /><img className={heroSlide === 1 ? 'hero-slide hero-slide-produce is-active' : 'hero-slide hero-slide-produce'} src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=90" alt="Fresh produce ready for delivery" /><img className={heroSlide === 2 ? 'hero-slide hero-slide-grocery is-active' : 'hero-slide hero-slide-grocery'} src="https://images.unsplash.com/photo-1601598851547-4302969d0614?auto=format&fit=crop&w=1200&q=90" alt="Everyday grocery essentials" /><img className={heroSlide === 3 ? 'hero-slide hero-slide-rider is-active' : 'hero-slide hero-slide-rider'} src="https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1200&q=90" alt="A rider delivering orders" /><div className="hero-delivery-label"><span /> Food, groceries + riders</div><div className="hero-media-controls"><button type="button" aria-label="Previous hero image" onClick={() => setHeroSlide((current) => (current + 3) % 4)}>←</button><span>{heroSlide + 1} / 4</span><button type="button" aria-label="Next hero image" onClick={() => setHeroSlide((current) => (current + 1) % 4)}>→</button></div></div></div>
        </section>

        <section className="category-section" id="restaurants"><div className="section-heading"><div><span className="section-kicker">START HERE</span><h2>What are you ordering today?</h2></div><a className="text-link" href="/markets" onClick={(event) => goTo(event, '/markets')}>View markets <ArrowRight size={16} /></a></div><div className="category-row"><button className="category-pill selected" onClick={() => navigateTo('/restaurants')}><span className="category-icon" aria-hidden="true"><UtensilsCrossed size={22} /></span><span className="category-picture-label"><strong>Restaurants</strong><small>Hot meals from local kitchens</small></span></button><button className="category-pill" onClick={() => navigateTo('/groceries')}><span className="category-icon" aria-hidden="true"><ShoppingBasket size={22} /></span><span className="category-picture-label"><strong>Groceries</strong><small>Fresh food and pantry staples</small></span></button><button className="category-pill" onClick={() => navigateTo('/markets')}><span className="category-icon" aria-hidden="true"><Store size={22} /></span><span className="category-picture-label"><strong>Markets</strong><small>Search products across stores</small></span></button><button className="category-pill category-pill-send" onClick={() => navigateTo('/send')}><span className="category-icon" aria-hidden="true"><Package size={22} /></span><span className="category-picture-label"><strong>Send a package</strong><small>A rider picks up and drops off</small></span></button><button className="category-pill" onClick={() => navigateTo('/menu')}><span className="category-icon" aria-hidden="true"><BookOpen size={22} /></span><span className="category-picture-label"><strong>Menu</strong><small>Browse every dish in one place</small></span></button></div></section>

        <section className="restaurant-section"><div className="section-heading"><div><span className="section-kicker">RESTAURANTS</span><h2>Good food from kitchens around Sapele.</h2></div><a className="text-link" href="/restaurants" onClick={(event) => goTo(event, '/restaurants')}>Browse restaurants <ArrowRight size={16} /></a></div>{partnerLoading ? <div className="empty-state">Loading approved restaurants...</div> : partnerError ? <div className="empty-state">{partnerError}</div> : <><div className="restaurant-grid">{filteredRestaurants.map((restaurant) => <button className="restaurant-card" key={restaurant.id} type="button" onClick={() => openPartner(restaurant)}><div className="restaurant-image">{restaurant.image ? <img src={restaurant.image} alt={restaurant.name} /> : <span className="restaurant-monogram" aria-hidden="true">{partnerInitials(restaurant.name)}</span>}<span className="open-label">{restaurant.openNow ? 'Open now' : 'Currently closed'}</span></div><div className="restaurant-info"><div className="restaurant-name-row"><h3>{restaurant.name}</h3>{restaurant.rating > 0 && <span className="rating"><Star size={14} fill="currentColor" />{restaurant.rating}</span>}</div><p>{restaurant.cuisine || restaurant.description || 'Approved local restaurant'}</p><div className="restaurant-meta"><span><Clock3 size={14} />{restaurant.prepTimeMinutes ? `${restaurant.prepTimeMinutes} min` : 'Preparation time on menu'}</span><span>Delivery at checkout</span></div></div></button>)}</div>{filteredRestaurants.length === 0 && <div className="empty-state">No approved restaurants are available yet.</div>}</>}</section>

        <section className="grocery-showcase"><div className="grocery-showcase-copy"><span className="section-kicker">GROCERIES</span><h2>Your market run, without the traffic.</h2><p>Rice, oil, provisions, and drinks from grocery stores we have checked, brought to your door by a local rider.</p><button className="primary-button" onClick={() => navigateTo('/groceries')}>Shop groceries <ArrowRight size={17} /></button></div><div className="grocery-showcase-products">{partnerLoading ? <div className="empty-state">Loading approved grocery stores...</div> : partnerError ? <div className="empty-state">{partnerError}</div> : approvedGroceries.length ? approvedGroceries.slice(0, 3).map((store, index) => <button className={`grocery-store-card grocery-store-card-${index + 1}`} key={store.id} onClick={() => openPartner(store)}>{store.image && <img src={store.image} alt={store.name} />}<span><strong>{store.name}</strong><small>View approved store</small></span></button>) : <div className="empty-state">No approved grocery stores are available yet.</div>}</div></section>

        {selectedRestaurant && <section className={selectedRestaurant.image ? 'spotlight-section' : 'spotlight-section spotlight-no-photo'}>{selectedRestaurant.image && <div className="spotlight-photo"><img src={selectedRestaurant.image} alt={selectedRestaurant.name} /></div>}<div className="spotlight-copy"><span className="section-kicker">FEATURED KITCHEN</span><h2>{selectedRestaurant.name}</h2><p>{selectedRestaurant.cuisine || selectedRestaurant.description || 'See what is on the menu today.'}</p><div className="spotlight-stats">{selectedRestaurant.rating > 0 && <span><Star size={16} fill="currentColor" /> {selectedRestaurant.rating} rating</span>}<span><Clock3 size={16} /> {selectedRestaurant.prepTimeMinutes ? `${selectedRestaurant.prepTimeMinutes} min preparation` : 'See menu for availability'}</span></div><button className="primary-button" onClick={() => openPartner(selectedRestaurant)}>See the menu <ArrowRight size={17} /></button></div></section>}

        <section className="logistics-section"><button className="logistics-rider-display" onClick={() => { window.history.pushState({}, '', '/riders'); setPath('/riders') }}><div className="logistics-copy"><span className="section-kicker">SEND A PACKAGE</span><h2>Sending something?<br /><em>We’ll pick it up.</em></h2><p>Documents, parcels, or the thing you left at home. Book a local rider to pick up and drop off anywhere in our Sapele delivery area.</p><span className="logistics-link">Ride with DOORSTEP <ArrowRight size={17} /></span><span className="logistics-link logistics-send-link" role="link" tabIndex={0} onClick={(event) => { event.stopPropagation(); navigateTo('/send') }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); navigateTo('/send') } }}>Send a package now <ArrowRight size={17} /></span></div><div className="logistics-visual"><div className="logistics-orbit" /><img src="https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1400&q=90" alt="DOORSTEP logistics rider on delivery" /><div className="logistics-status"><span /> Available in Sapele</div><div className="logistics-badge"><strong>Fast</strong><small>local delivery</small></div></div></button></section>

        <section className="trust-section" id="how-it-works"><div><Compass size={27} /><h3>Checked before listing</h3><p>Every restaurant, store, and rider is reviewed before they can take orders.</p></div><div><Clock3 size={27} /><h3>Track every order</h3><p>Follow your order from the kitchen to your door with live rider tracking.</p></div><div><Heart size={27} /><h3>Pay the way you like</h3><p>Pay by card through Paystack or by bank transfer.</p></div></section>
      </main>

      <footer id="partner"><div className="footer-brand"><a className="brand" href="/" onClick={(event) => goTo(event, '/')}><span className="brand-mark"><Sparkles size={17} /></span><span>doorstep</span></a><p>Food, groceries, and essentials.<br />Delivered in Sapele.</p></div><div className="footer-links"><div><span>EXPLORE</span><a href="/restaurants" onClick={(event) => goTo(event, '/restaurants')}>Restaurants</a><a href="/groceries" onClick={(event) => goTo(event, '/groceries')}>Groceries</a><a href="/how-it-works" onClick={(event) => goTo(event, '/how-it-works')}>How it works</a></div><div><span>PARTNER</span><a href="/partner/register/restaurant" onClick={(event) => goTo(event, '/partner/register/restaurant')}>List your restaurant</a><a href="/partners/groceries/register" onClick={(event) => goTo(event, '/partners/groceries/register')}>List your grocery store</a><a href="/rider/register" onClick={(event) => goTo(event, '/rider/register')}>Ride with us</a></div></div><p className="copyright">© 2026 DOORSTEP. Made for Sapele.</p></footer>

      {cartOpen && <div className="cart-overlay" onClick={() => setCartOpen(false)}><aside className="cart-drawer" onClick={(event) => event.stopPropagation()}><div className="cart-header"><div><span className="section-kicker">YOUR ORDER</span><h2>Cart <span>({cartCount})</span></h2></div><button className="close-button" onClick={() => setCartOpen(false)} aria-label="Close cart"><X size={21} /></button></div>{cart.length === 0 ? <div className="cart-empty"><ShoppingBag size={34} /><p>Your cart is waiting for something delicious.</p><button className="primary-button" onClick={() => setCartOpen(false)}>Browse food</button></div> : <><div className="cart-restaurant">{cart[0].restaurantName}<small>One kitchen per order</small></div><div className="cart-items">{cart.map((item) => <div className="cart-item" key={item.id}><img src={item.image} alt="" /><div className="cart-item-info"><h3>{item.name}</h3><strong>{formatNaira(item.price * item.quantity)}</strong><div className="quantity"><button onClick={() => changeQuantity(item.id, -1)}><Minus size={14} /></button><span>{item.quantity}</span><button onClick={() => changeQuantity(item.id, 1)}><Plus size={14} /></button></div></div></div>)}</div><div className="cart-summary"><div><span>Subtotal</span><strong>{formatNaira(subtotal)}</strong></div><div><span>Delivery</span><strong>{formatNaira(cart[0].deliveryFee || 800)}</strong></div><div><span>Service fee</span><strong>{formatNaira(Math.round(subtotal * 0.03))}</strong></div><div className="total"><span>Total</span><strong>{formatNaira(subtotal + (cart[0].deliveryFee || 800) + Math.round(subtotal * 0.03))}</strong></div><button className="checkout-button" onClick={() => { setCartOpen(false); setCheckoutOpen(true) }}>Continue to checkout <ArrowRight size={17} /></button></div></>}</aside></div>}
      {checkoutOpen && <div className="cart-overlay" onClick={() => setCheckoutOpen(false)}><section className="checkout-panel" onClick={(event) => event.stopPropagation()}><div className="cart-header"><div><span className="section-kicker">SECURE CHECKOUT</span><h2>Your details</h2></div><button className="close-button" onClick={() => setCheckoutOpen(false)} aria-label="Close checkout"><X size={21} /></button></div><form onSubmit={completeOrder}><label>Delivery address<input required name="address" defaultValue="Amukpe, Sapele" placeholder="Street, area and landmark" /></label><label>Phone number<input required name="phone" inputMode="tel" placeholder="080 0000 0000" /></label><div className="checkout-note"><MapPin size={17} /><span>We’ll use this address for delivery updates.</span></div><div className="checkout-total"><span>Total to pay</span><strong>{formatNaira(subtotal + (cart[0]?.deliveryFee || 800) + Math.round(subtotal * 0.03))}</strong></div><button className="checkout-button" type="submit">Pay securely <ArrowRight size={17} /></button><small className="payment-disclaimer">Your order is created and payment is verified by the DOORSTEP server before fulfillment.</small></form></section></div>}
      <MobileStoreDock />
      <CookieConsent />
      <ChatWidget open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} />
    </div>
  )
}

export default App

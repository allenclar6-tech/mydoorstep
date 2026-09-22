import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Bell, Bot, Camera, Check, ChevronDown, Clock3, Compass, Heart, LogOut, MapPin, Menu, MessageCircle, Minus, Plus, Search, ShoppingBag, Sparkles, Star, UserCircle, X } from 'lucide-react'
import { categories, formatNaira, restaurants, sapeleLocations } from './data'
import { loadCart, saveCart } from './services/orderService'
import { RoutePage } from './pages'
import { RestaurantPortal } from './portalPages'
import { RiderPortal } from './riderPages'
import { AdminLogin, AdminPortal } from './adminPages'
import { ForgotPasswordPage } from './accountPages'

const currentPath = () => window.location.pathname.replace(/\/$/, '') || '/'

function HeaderSignOut() { return <button className="header-signout" aria-label="Sign out" title="Sign out" onClick={async () => { await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}` } }).catch(() => undefined); localStorage.removeItem('doorstep-token'); window.location.assign('/') }}><LogOut size={16} /></button> }

function PortalAccessGate({ role, children }) { const [state, setState] = useState('loading'); useEffect(() => { const token = localStorage.getItem('doorstep-token'); if (!token) { setState('missing'); return } fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => setState(body.user?.role === role ? 'allowed' : 'wrong-role')).catch(() => setState('missing')) }, [role]); if (state === 'loading') return <main className="route-page"><div className="submitted-card"><Clock3 size={24} /><h2>Checking secure access</h2><p>Verifying your DOORSTEP portal permissions.</p></div></main>; if (state === 'allowed') return children; return <div className="app-shell"><RoutePage path={state === 'wrong-role' ? '/account' : '/login'} /></div> }


function LegacyChatWidget({ open, onToggle }) {
  const [message, setMessage] = useState('')
  const [ticket, setTicket] = useState(null)
  const [aiReply, setAiReply] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [activeTicket, setActiveTicket] = useState(null)
  const [error, setError] = useState('')
  const [aiTyping, setAiTyping] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
    const send = async (event) => { event.preventDefault(); if (!message.trim()) return; const text = message; const token = localStorage.getItem('doorstep-token'); setChatMessages((current) => [...current, { senderType: 'CUSTOMER', body: text }]); setMessage(''); setPhoto(null); setPhotoPreview(''); setError(''); if (!token) { const reply = 'I can help with DOORSTEP ordering, payments, delivery tracking, restaurants, account access, and support. Sign in if you want me to save this conversation for an agent.'; setChatMessages((current) => [...current, { senderType: 'AI', body: reply }]); return } let attachments = []; try { const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/support/tickets`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'TECHNICAL', description: text, attachments }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not send your message.'); const reply = body.aiReply?.body || 'I’ve received your message and created a support ticket for the DOORSTEP team.'; setAiReply(reply); setChatMessages((current) => [...current, { senderType: 'AI', body: reply }]); setTicket(body.ticket); setActiveTicket(body.ticket) } catch (sendError) { setError(sendError.message) } }
    useEffect(() => { if (!open) return; const token = localStorage.getItem('doorstep-token'); if (!token) return; fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/support/tickets`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => { const latest = body.tickets?.[0]; if (latest) { setActiveTicket(latest); setTicket(latest); setChatMessages(latest.messages || []) } }).catch(() => undefined) }, [open])
  return <div className="chat-widget"><button className="chat-launcher" onClick={onToggle} aria-label="Open live chat"><MessageCircle size={20} /><span>Chat</span></button>{open && <section className="chat-panel"><div className="chat-panel-header"><div className="chat-agent"><span className="chat-agent-avatar"><Bot size={17} /></span><div><span className="section-kicker">DOORSTEP AI SUPPORT</span><h2>Let’s sort it out.</h2></div></div><button onClick={onToggle} aria-label="Close chat"><X size={17} /></button></div><div className="chat-status"><span /> AI robot online · human handoff ready</div>{ticket ? <><div className="chat-user-bubble">Your message has been sent to support.</div><div className="chat-ai-bubble"><span className="chat-bot-badge"><Bot size={14} /></span><div><strong>DOORSTEP AI</strong><p>{aiReply}</p></div></div><div className="chat-sent"><span className="chat-sent-orbit"><Check size={22} /></span><strong>Ticket {ticket.ticketNumber}</strong><p>The support team can continue this conversation from the admin support inbox.</p></div></> : <><div className="chat-welcome"><span>AI support concierge</span><p>Tell me what happened. Add a photo when it helps us see the issue faster.</p></div><div className="chat-topics"><button onClick={() => setMessage('I have a payment problem with my order.')}>Payment problem <ArrowRight size={12} /></button><button onClick={() => setMessage('My delivery is late.')}>Late delivery <ArrowRight size={12} /></button><button onClick={() => setMessage('I need help with my account.')}>Account help <ArrowRight size={12} /></button></div><form onSubmit={send}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type your message..." rows="3" />{photoPreview && <div className="chat-photo-preview"><img src={photoPreview} alt="Selected support attachment" /><button type="button" onClick={() => { setPhoto(null); setPhotoPreview('') }}><X size={13} /></button></div>}<div className="chat-composer-row"><label className="chat-photo-button" title="Attach a photo"><Camera size={16} /><input type="file" accept="image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setPhoto(file); setPhotoPreview(URL.createObjectURL(file)) }} /></label><button className="chat-send" type="submit">Send to support <ArrowRight size={15} /></button></div>{error && <small className="chat-error">{error}</small>}</form></>}<button className="chat-support-link" onClick={() => { onToggle(); window.history.pushState({}, '', '/account/support'); window.dispatchEvent(new PopStateEvent('popstate')) }}>Open full support center <ArrowRight size={14} /></button></section>}</div>
  return <div className="chat-widget"><button className="chat-launcher" onClick={onToggle} aria-label="Open live chat"><MessageCircle size={20} /><span>Chat</span></button>{open && <section className="chat-panel"><div className="chat-panel-header"><div className="chat-agent"><span className="chat-agent-avatar"><Bot size={17} /></span><div><span className="section-kicker">DOORSTEP SUPPORT CHAT</span><h2>Conversation</h2></div></div><button onClick={onToggle} aria-label="Close chat"><X size={17} /></button></div><div className="chat-status"><span /> Customer ↔ DOORSTEP agent</div><div className="chat-thread">{chatMessages.length === 0 && <div className="chat-welcome"><span>Support is here</span><p>Send a message and the DOORSTEP assistant will reply instantly. An agent can continue the conversation.</p></div>}{chatMessages.map((item, index) => item.senderType === 'CUSTOMER' ? <div className="chat-user-bubble" key={index}><small>You</small>{item.body}</div> : <div className={item.senderType === 'ADMIN' ? 'chat-agent-bubble' : 'chat-ai-bubble'} key={index}><span className="chat-bot-badge">{item.senderType === 'ADMIN' ? 'A' : <Bot size={14} />}</span><div><strong>{item.senderType === 'ADMIN' ? 'DOORSTEP agent' : 'DOORSTEP AI'}</strong><p>{item.body}</p></div></div>)}</div>{activeTicket && <div className="chat-ticket-chip"><Check size={13} /> Conversation {activeTicket.ticketNumber}</div>}<form onSubmit={send}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write to the DOORSTEP team..." rows="3" />{photoPreview && <div className="chat-photo-preview"><img src={photoPreview} alt="Selected support attachment" /><button type="button" onClick={() => { setPhoto(null); setPhotoPreview('') }}><X size={13} /></button></div>}<div className="chat-composer-row"><label className="chat-photo-button" title="Attach a photo"><Camera size={16} /><input type="file" accept="image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setPhoto(file); setPhotoPreview(URL.createObjectURL(file)) }} /></label><button className="chat-send" type="submit">Send <ArrowRight size={15} /></button></div>{error && <small className="chat-error">{error}</small>}</form><button className="chat-support-link" onClick={() => { onToggle(); window.history.pushState({}, '', '/account/support'); window.dispatchEvent(new PopStateEvent('popstate')) }}>Open full support center <ArrowRight size={14} /></button></section>}</div>
}

function ChatWidget({ open, onToggle }) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const [ticket, setTicket] = useState(null)
  const [error, setError] = useState('')
  const [aiTyping, setAiTyping] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  useEffect(() => { if (!open) return; const token = localStorage.getItem('doorstep-token'); if (!token) return; fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/support/tickets`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => { const latest = body.tickets?.[0]; if (latest) { setTicket(latest); setMessages(latest.messages || []) } }).catch(() => undefined) }, [open])
  const send = async (event) => { event.preventDefault(); const text = message.trim(); if (!text && !photo) return; setMessage(''); setError(''); setMessages((current) => [...current, { senderType: 'CUSTOMER', body: text || 'Media attachment' }]); setAiTyping(true); const token = localStorage.getItem('doorstep-token'); if (!token) { try { const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/support/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text || 'I have attached a photo for assistance.' }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Support is unavailable.'); window.setTimeout(() => { setMessages((current) => [...current, { senderType: 'AI', body: body.reply }]); setAiTyping(false) }, 650) } catch (sendError) { setAiTyping(false); setError(sendError.message) } return } try { let attachments = []; if (photo) { const uploadData = new FormData(); uploadData.append('document', photo); const uploadResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/uploads/private-document`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: uploadData }); const uploadBody = await uploadResponse.json(); if (!uploadResponse.ok) throw new Error(uploadBody.error || 'The media upload could not be completed.'); attachments = [uploadBody.storageKey] } const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/support/tickets`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'TECHNICAL', description: text || 'I have attached a photo for assistance.', attachments }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Support is unavailable.'); setPhoto(null); setPhotoPreview(''); window.setTimeout(() => { setTicket(body.ticket); setMessages((current) => [...current, body.aiReply]); setAiTyping(false) }, 650) } catch (sendError) { setAiTyping(false); setError(sendError.message) } }
  return <div className="chat-widget"><button className="chat-launcher" onClick={onToggle} aria-label="Open live chat"><MessageCircle size={20} /><span>Chat</span></button>{open && <section className="chat-panel"><div className="chat-panel-header"><div className="chat-agent"><span className="chat-agent-avatar online-agent-avatar"><Bot size={17} /><i /></span><div><span className="section-kicker">DOORSTEP ONLINE AGENT</span><h2>Live assistance</h2></div></div><button onClick={onToggle} aria-label="Close chat"><X size={17} /></button></div><div className="chat-status"><span /> DOORSTEP ONLINE AGENT is ready to assist</div><div className="chat-thread">{messages.length === 0 && <div className="chat-welcome"><span>Welcome to DOORSTEP</span><p>I’m your DOORSTEP ONLINE AGENT. I can help you find a restaurant, choose from the menu, confirm delivery details, review an order, resolve payment questions, and connect you with our support team.</p></div>}{messages.map((item, index) => <div className={item.senderType === 'CUSTOMER' ? 'chat-user-bubble' : item.senderType === 'ADMIN' ? 'chat-agent-bubble' : 'chat-ai-bubble'} key={`${item.id || item.createdAt || index}-${index}`}><strong>{item.senderType === 'CUSTOMER' ? 'You' : item.senderType === 'ADMIN' ? 'DOORSTEP Support' : 'DOORSTEP ONLINE AGENT'}</strong><p>{item.body}</p></div>)}{aiTyping && <div className="chat-typing"><span className="chat-bot-badge online-agent-avatar"><Bot size={13} /><i /></span><span>DOORSTEP ONLINE AGENT is preparing a response</span><i /><i /><i /></div>}</div><form onSubmit={send}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="How may we assist you?" rows="3" />{photoPreview && <div className="chat-photo-preview"><img src={photoPreview} alt="Selected media attachment" /><button type="button" aria-label="Remove media attachment" onClick={() => { setPhoto(null); setPhotoPreview('') }}><X size={13} /></button></div>}{error && <small className="chat-error">{error}</small>}<div className="chat-composer-row"><label className="chat-photo-button" title="Attach a photo"><Camera size={16} /><input type="file" accept="image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setPhoto(file); setPhotoPreview(URL.createObjectURL(file)) }} /></label><button className="chat-send" type="submit">Send message <ArrowRight size={15} /></button></div></form><button className="chat-support-link" onClick={() => { onToggle(); window.history.pushState({}, '', '/account/support'); window.dispatchEvent(new PopStateEvent('popstate')) }}>Open support centre <ArrowRight size={14} /></button></section>}</div>
}

function App() {
  const [path, setPath] = useState(currentPath)
  const [activeCategory, setActiveCategory] = useState('All food')
  const [search, setSearch] = useState('')
  const [selectedRestaurant, setSelectedRestaurant] = useState(restaurants[0])
  const [restaurantSlide, setRestaurantSlide] = useState(0)
  const restaurantRailRef = useRef(null)
  const [cart, setCart] = useState(() => loadCart())
  const [cartOpen, setCartOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [order, setOrder] = useState(null)
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutIdempotencyKey] = useState(() => window.crypto?.randomUUID?.() || `checkout-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const [deliveryLocation, setDeliveryLocation] = useState(() => localStorage.getItem('doorstep-location') || 'Amukpe, Sapele')
  const [locationOpen, setLocationOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    const onPopState = () => setPath(currentPath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  })

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
      const restaurant = restaurants.find((item) => item.name === label.slice(5)); if (!restaurant) return
      fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/favorites`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId: restaurant.id }) }).then((response) => { if (response.ok || response.status === 409) element.classList.toggle('is-saved') }).catch(() => undefined)
    }
    document.addEventListener('click', onMarketplaceAction, true)
    return () => document.removeEventListener('click', onMarketplaceAction, true)
  }, [])

  useEffect(() => {
    const onAccountAction = (event) => {
      const element = event.target.closest('button')
      if (!element) return
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
      if (token && !existing) {
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
        confirm.onclick = async () => { await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined); localStorage.removeItem('doorstep-token'); window.location.assign('/') }
        wrapper.append(button, confirm)
        actions.insertBefore(wrapper, actions.querySelector('.cart-button'))
      } else if (!token && existing) existing.remove()
    })
    const token = localStorage.getItem('doorstep-token')
    if (token) fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => {
      if (!body.user) return
      document.querySelectorAll('.profile-button').forEach((button) => {
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
    fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => { if (response.status === 401) { localStorage.removeItem('doorstep-token'); window.history.replaceState({}, '', '/login'); setPath('/login') } }).catch(() => undefined)
  }, [path])

  useEffect(() => {
    if (path !== '/account/profile') return
    const input = document.querySelector('.profile-photo-picker input[type="file"]')
    if (!input || input.dataset.uploadBound) return
    input.dataset.uploadBound = 'true'
    input.addEventListener('change', async (event) => {
      const file = event.target.files?.[0]
      const token = localStorage.getItem('doorstep-token')
      if (!file || !token) return
      const data = new FormData(); data.append('document', file)
      const upload = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/uploads/private-document`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data })
      const stored = await upload.json()
      if (!upload.ok) return window.alert(stored.error || 'Could not upload profile picture.')
      await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'}/api/profile/photo`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ storageKey: stored.storageKey }) })
      window.alert('Profile picture saved.')
    })
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
  const useCurrentLocation = () => navigator.geolocation?.getCurrentPosition((position) => chooseLocation(`Current device · ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`), () => setLocationOpen(false))

  const goTo = (event, destination) => {
    if (!destination.startsWith('#')) {
      event.preventDefault()
      window.history.pushState({}, '', destination)
      setPath(destination)
      setMenuOpen(false)
    }
  }

  const filteredRestaurants = useMemo(() => restaurants.filter((restaurant) => {
    const matchesCategory = activeCategory === 'All food' || restaurant.category === activeCategory
    const query = search.toLowerCase()
    return matchesCategory && (!query || `${restaurant.name} ${restaurant.cuisine} ${restaurant.items.map((item) => item.name).join(' ')}`.toLowerCase().includes(query))
  }), [activeCategory, search])

  const showRestaurantSlide = (index) => { const nextIndex = (index + filteredRestaurants.length) % Math.max(filteredRestaurants.length, 1); setRestaurantSlide(nextIndex); const restaurant = filteredRestaurants[nextIndex]; if (restaurant) setSelectedRestaurant(restaurant) }
  useEffect(() => { const rail = document.querySelector('.restaurant-grid'); if (!rail || filteredRestaurants.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined; let paused = false; const move = () => { if (paused) return; const card = rail.querySelector('.restaurant-card'); if (!card) return; const next = rail.scrollLeft + card.getBoundingClientRect().width + 19; rail.scrollTo({ left: next >= rail.scrollWidth - rail.clientWidth - 4 ? 0 : next, behavior: 'smooth' }) }; const pause = () => { paused = true }; const resume = () => { paused = false }; rail.addEventListener('mouseenter', pause); rail.addEventListener('mouseleave', resume); rail.addEventListener('focusin', pause); rail.addEventListener('focusout', resume); const timer = window.setInterval(move, 4200); return () => { window.clearInterval(timer); rail.removeEventListener('mouseenter', pause); rail.removeEventListener('mouseleave', resume); rail.removeEventListener('focusin', pause); rail.removeEventListener('focusout', resume) } }, [filteredRestaurants.length])

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  const addToCart = (item, restaurantOverride = selectedRestaurant) => {
    const restaurant = restaurantOverride
    if (cart.length && cart[0].restaurantId !== restaurant.id) {
      const replace = window.confirm(`Your cart has items from ${cart[0].restaurantName}. Replace them with ${restaurant.name}?`)
      if (!replace) return
    }

    const cartItem = { ...item, restaurantId: restaurant.id, restaurantName: restaurant.name, deliveryFee: Number(restaurant.fee.replace(/[^0-9]/g, '')) }
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
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
      const orderResponse = await fetch(`${apiBase}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': checkoutIdempotencyKey, Authorization: `Bearer ${token}` }, body: JSON.stringify({ restaurantId: String(cart[0].restaurantId), items: cart.map((item) => ({ menuItemId: item.id, quantity: item.quantity })), addressLine: form.get('address'), landmark: form.get('landmark'), phone: form.get('phone') }) })
      const orderBody = await orderResponse.json()
      if (!orderResponse.ok) throw new Error(orderBody.message || orderBody.error || 'Could not create your order.')
      const paymentResponse = await fetch(`${apiBase}/api/payments/initialize`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ orderId: orderBody.order.id }) })
      const paymentBody = await paymentResponse.json()
      if (!paymentResponse.ok) throw new Error(paymentBody.message || paymentBody.error || 'Could not start payment.')
      saveCart([])
      setCart([])
      window.location.assign(paymentBody.authorizationUrl)
    } catch (error) { setCheckoutError(error.message); window.alert(error.message) }
  }

  if (path.startsWith('/restaurant/') && !localStorage.getItem('doorstep-token')) return <div className="app-shell"><RoutePage path="/login" /></div>
  if (path.startsWith('/rider/') && !localStorage.getItem('doorstep-token')) return <div className="app-shell"><RoutePage path="/login" /></div>
  if (path.startsWith('/restaurant/')) return <PortalAccessGate role="RESTAURANT"><RestaurantPortal path={path} /></PortalAccessGate>
  if (path.startsWith('/rider/')) return <PortalAccessGate role="RIDER"><RiderPortal path={path} /></PortalAccessGate>
  if (path === '/admin/login') return <AdminLogin onLogin={() => { window.history.pushState({}, '', '/admin/dashboard'); setPath('/admin/dashboard') }} />
  if (path === '/forgot-password' || path === '/reset-password') return <ForgotPasswordPage />
  if (path.startsWith('/admin/') && !localStorage.getItem('doorstep-admin-token')) return <AdminLogin onLogin={() => { window.history.pushState({}, '', path); setPath(path) }} />
  if (path.startsWith('/admin/')) return <AdminPortal path={path} />
  if (path.startsWith('/account') && !localStorage.getItem('doorstep-token')) return <div className="app-shell"><RoutePage path="/login" /></div>

  if (path !== '/') return <div className="app-shell"><header className="topbar"><a className="brand" href="/" onClick={(event) => goTo(event, '/')} aria-label="DOORSTEP home"><span className="brand-mark"><Sparkles size={17} strokeWidth={2.5} /></span><span>doorstep</span></a><nav className={menuOpen ? 'main-nav is-open' : 'main-nav'}><a href="/restaurants" onClick={(event) => goTo(event, '/restaurants')}>Restaurants</a><a href="/food" onClick={(event) => goTo(event, '/food')}>Food</a><a href="/offers" onClick={(event) => goTo(event, '/offers')}>Offers</a><a href="/help" onClick={(event) => goTo(event, '/help')}>Help</a></nav><div className="top-actions"><button className="icon-button notification" aria-label="Notifications"><Bell size={19} /></button>{localStorage.getItem('doorstep-token') ? <button className="profile-button" onClick={(event) => goTo(event, '/account')} aria-label="Open account"><UserCircle size={22} /></button> : <button className="login-button" onClick={(event) => goTo(event, '/login')}>Log in</button>}<button className="cart-button" onClick={() => { window.history.pushState({}, '', '/cart'); setPath('/cart') }}><ShoppingBag size={18} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button></div><button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu"><Menu size={22} /></button></header><RoutePage path={path} cart={cart} checkoutError={checkoutError} onAddToCart={(item, restaurant) => { addToCart(item, restaurant); setPath('/cart'); window.history.pushState({}, '', '/cart') }} onChangeQuantity={changeQuantity} onCheckout={() => { window.history.pushState({}, '', '/checkout'); setPath('/checkout') }} onComplete={completeOrder} /><ChatWidget open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} /></div>

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DOORSTEP home"><span className="brand-mark"><Sparkles size={17} strokeWidth={2.5} /></span><span>doorstep</span></a>
        <nav className={menuOpen ? 'main-nav is-open' : 'main-nav'}>
          <a className="active" href="/" onClick={(event) => goTo(event, '/')}>Home</a><a href="/restaurants" onClick={(event) => goTo(event, '/restaurants')}>Restaurants</a><a href="/food" onClick={(event) => goTo(event, '/food')}>Food</a><a href="/offers" onClick={(event) => goTo(event, '/offers')}>Offers</a><a href="/how-it-works" onClick={(event) => goTo(event, '/how-it-works')}>How it works</a><a href="/help" onClick={(event) => goTo(event, '/help')}>Help</a>
        </nav>
        <div className="top-actions"><button className="icon-button notification" aria-label="Notifications" onClick={(event) => goTo(event, '/account/notifications')}><Bell size={19} /></button>{localStorage.getItem('doorstep-token') ? <button className="profile-button" onClick={(event) => goTo(event, '/account')} aria-label="Open account"><UserCircle size={22} /></button> : <><button className="login-button" onClick={(event) => goTo(event, '/login')}>Log in</button><button className="signup-button" onClick={(event) => goTo(event, '/register')}>Sign up</button></>}<button className="cart-button" onClick={() => setCartOpen(true)}><ShoppingBag size={18} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button></div>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu"><Menu size={22} /></button>
      </header>
      <main id="top">
        <section className="hero-section">
          <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> Sapele, Delta State</div><h1>Good food,<br /><em>closer</em> to home.</h1><p>Find the flavours you love from the kitchens that make Sapele special. Delivered warm, right to your doorstep.</p><div className="search-wrap"><Search size={20} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search for food or a restaurant" /><button aria-label="Search"><ArrowRight size={20} /></button></div><div className="location-dropdown-wrap"><button className="delivery-note delivery-location-button" onClick={() => setLocationOpen(!locationOpen)}><MapPin size={16} /><span>Delivering to <strong>{deliveryLocation}</strong></span><ChevronDown size={15} /></button>{locationOpen && <div className="location-dropdown"><button onClick={useCurrentLocation}><MapPin size={16} /><span><strong>Use current device location</strong><small>Allow browser location access</small></span></button><span className="dropdown-label">SAPELE AREAS</span>{sapeleLocations.map((location) => <button key={location} onClick={() => chooseLocation(location)}><MapPin size={14} /><span>{location}</span></button>)}<button className="dropdown-manage" onClick={() => { setLocationOpen(false); window.history.pushState({}, '', '/location'); setPath('/location') }}>Manage saved addresses <ArrowRight size={14} /></button></div>}</div></div>
          <div className="hero-art"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-image-wrap"><img src="https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=90" alt="A vibrant Nigerian meal in a serving bowl" /><div className="floating-rating"><span className="rating-icon"><Star size={15} fill="currentColor" /></span><div><strong>4.9</strong><small>local favourite</small></div></div></div><div className="hero-sticker"><span>made with</span><strong>♡</strong><span>good energy</span></div></div>
        </section>

        <section className="category-section" id="restaurants"><div className="section-heading"><div><span className="section-kicker">WHAT ARE YOU CRAVING?</span><h2>Take your pick.</h2></div><a className="text-link" href="#all">View all <ArrowRight size={16} /></a></div><div className="category-row">{categories.map((category) => <button key={category.name} className={activeCategory === category.name ? 'category-pill selected' : 'category-pill'} onClick={() => setActiveCategory(category.name)}><span>{category.icon}</span>{category.name}</button>)}</div></section>

        <section className="restaurant-section"><div className="section-heading"><div><span className="section-kicker">NEAR YOU IN SAPELE</span><h2>Worth leaving the house for.</h2></div><div className="carousel-controls"><button aria-label="Previous restaurants">←</button><button aria-label="Next restaurants">→</button></div></div><div className="restaurant-grid">{filteredRestaurants.map((restaurant) => <article className="restaurant-card" key={restaurant.id} onClick={() => setSelectedRestaurant(restaurant)}><div className="restaurant-image"><img src={restaurant.image} alt={restaurant.name} /><button className="favourite" aria-label={`Save ${restaurant.name}`} onClick={(event) => event.stopPropagation()}><Heart size={17} /></button><span className={`open-label ${restaurant.accent}`}>Open now</span></div><div className="restaurant-info"><div className="restaurant-name-row"><h3>{restaurant.name}</h3><span className="rating"><Star size={14} fill="currentColor" />{restaurant.rating}</span></div><p>{restaurant.cuisine}</p><div className="restaurant-meta"><span><Clock3 size={14} />{restaurant.time}</span><span>{restaurant.fee}</span></div></div></article>)}</div>{filteredRestaurants.length === 0 && <div className="empty-state">No kitchens found for that search. Try “jollof” or browse all food.</div>}</section>

        <section className="spotlight-section"><div className="spotlight-photo"><img src={selectedRestaurant.image} alt="" /></div><div className="spotlight-copy"><span className="section-kicker">TODAY'S SPOTLIGHT</span><h2>{selectedRestaurant.name}</h2><p>{selectedRestaurant.cuisine}. Something delicious is already on the way.</p><div className="spotlight-stats"><span><Star size={16} fill="currentColor" /> {selectedRestaurant.rating} rating</span><span><Clock3 size={16} /> {selectedRestaurant.time}</span></div><button className="primary-button" onClick={() => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' })}>See the menu <ArrowRight size={17} /></button></div></section>

        <section className="menu-section" id="menu"><div className="section-heading"><div><span className="section-kicker">FROM {selectedRestaurant.name.toUpperCase()}</span><h2>Made for the moment.</h2></div></div><div className="menu-grid">{selectedRestaurant.items.map((item) => <article className="menu-card" key={item.id}><img src={item.image} alt={item.name} /><div className="menu-card-body"><div className="menu-tag">{item.tag || 'Kitchen favourite'}</div><h3>{item.name}</h3><p>{item.description}</p><div className="menu-bottom"><strong>{formatNaira(item.price)}</strong><button className="add-button" onClick={() => { addToCart(item); setCartOpen(true) }}><Plus size={18} /> Add</button></div></div></article>)}</div></section>

        <section className="trust-section" id="how-it-works"><div><Compass size={27} /><h3>Curated for Sapele</h3><p>Good local kitchens, thoughtfully brought together.</p></div><div><Clock3 size={27} /><h3>On time, every time</h3><p>We keep an eye on every order from pot to porch.</p></div><div><Heart size={27} /><h3>Made for real life</h3><p>Easy ordering for busy days and hungry nights.</p></div></section>
      </main>

      <footer id="partner"><div className="footer-brand"><a className="brand" href="#top"><span className="brand-mark"><Sparkles size={17} /></span><span>doorstep</span></a><p>Good food. Good neighbours.<br />Delivered in Sapele.</p></div><div className="footer-links"><div><span>EXPLORE</span><a href="#restaurants">Restaurants</a><a href="#menu">Popular dishes</a><a href="#how-it-works">How it works</a></div><div><span>PARTNER</span><a href="#partner">List your restaurant</a><a href="#partner">Ride with us</a><a href="#partner">Support</a></div></div><p className="copyright">© 2026 DOORSTEP. Made for Sapele.</p></footer>

      {order && <section className="order-success"><div className="success-mark"><Sparkles size={24} /></div><span className="section-kicker">ORDER CONFIRMED</span><h2>We’re on it.</h2><p>Your order <strong>{order.orderNumber}</strong> from {order.restaurantName} has been sent to the kitchen.</p><div className="success-status"><span>1</span><div><strong>Payment confirmed</strong><small>{formatNaira(order.total)} · {order.address}</small></div></div><button className="primary-button" onClick={() => setOrder(null)}>Keep browsing <ArrowRight size={17} /></button></section>}
      {cartOpen && <div className="cart-overlay" onClick={() => setCartOpen(false)}><aside className="cart-drawer" onClick={(event) => event.stopPropagation()}><div className="cart-header"><div><span className="section-kicker">YOUR ORDER</span><h2>Cart <span>({cartCount})</span></h2></div><button className="close-button" onClick={() => setCartOpen(false)} aria-label="Close cart"><X size={21} /></button></div>{cart.length === 0 ? <div className="cart-empty"><ShoppingBag size={34} /><p>Your cart is waiting for something delicious.</p><button className="primary-button" onClick={() => setCartOpen(false)}>Browse food</button></div> : <><div className="cart-restaurant">{cart[0].restaurantName}<small>One kitchen per order</small></div><div className="cart-items">{cart.map((item) => <div className="cart-item" key={item.id}><img src={item.image} alt="" /><div className="cart-item-info"><h3>{item.name}</h3><strong>{formatNaira(item.price * item.quantity)}</strong><div className="quantity"><button onClick={() => changeQuantity(item.id, -1)}><Minus size={14} /></button><span>{item.quantity}</span><button onClick={() => changeQuantity(item.id, 1)}><Plus size={14} /></button></div></div></div>)}</div><div className="cart-summary"><div><span>Subtotal</span><strong>{formatNaira(subtotal)}</strong></div><div><span>Delivery</span><strong>{formatNaira(cart[0].deliveryFee || 800)}</strong></div><div><span>Service fee</span><strong>{formatNaira(Math.round(subtotal * 0.03))}</strong></div><div className="total"><span>Total</span><strong>{formatNaira(subtotal + (cart[0].deliveryFee || 800) + Math.round(subtotal * 0.03))}</strong></div><button className="checkout-button" onClick={() => { setCartOpen(false); setCheckoutOpen(true) }}>Continue to checkout <ArrowRight size={17} /></button></div></>}</aside></div>}
      {checkoutOpen && <div className="cart-overlay" onClick={() => setCheckoutOpen(false)}><section className="checkout-panel" onClick={(event) => event.stopPropagation()}><div className="cart-header"><div><span className="section-kicker">SECURE CHECKOUT</span><h2>Your details</h2></div><button className="close-button" onClick={() => setCheckoutOpen(false)} aria-label="Close checkout"><X size={21} /></button></div><form onSubmit={completeOrder}><label>Delivery address<input required name="address" defaultValue="Amukpe, Sapele" placeholder="Street, area and landmark" /></label><label>Phone number<input required name="phone" inputMode="tel" placeholder="080 0000 0000" /></label><div className="checkout-note"><MapPin size={17} /><span>We’ll use this address for delivery updates.</span></div><div className="checkout-total"><span>Total to pay</span><strong>{formatNaira(subtotal + (cart[0]?.deliveryFee || 800) + Math.round(subtotal * 0.03))}</strong></div><button className="checkout-button" type="submit">Pay securely <ArrowRight size={17} /></button><small className="payment-disclaimer">Your order is created and payment is verified by the DOORSTEP server before fulfillment.</small></form></section></div>}
      <ChatWidget open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} />
    </div>
  )
}

export default App

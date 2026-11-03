import { useEffect, useMemo, useState } from 'react'
import { apiBase } from '../config/apiBase'
import { readConfirmedLocation } from '../location'
import { loadCart, saveCart } from '../services/orderService'

// Data layer for the DOORSTEP customer app: home feed, store pages, cart, address and checkout quote.

export const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo?.(0, 0) }
export const token = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
export const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' })
export const naira = (minor) => `₦${Math.round((minor || 0) / 100).toLocaleString('en-NG')}`
export const nairaWhole = (value) => `₦${Math.round(value || 0).toLocaleString('en-NG')}`
const read = (key, fallback = null) => { try { const value = localStorage.getItem(key); return value == null ? fallback : value } catch { return fallback } }
const write = (key, value) => { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* private mode */ } }

export const VERTICALS = {
  FOOD: { key: 'FOOD', label: 'Food', path: '/food', blurb: 'Kitchens near you' },
  GROCERIES: { key: 'GROCERIES', label: 'Groceries', path: '/groceries', blurb: 'Market run, done' },
  SHOPS: { key: 'SHOPS', label: 'Shops', path: '/shops', blurb: 'Phones, fashion & more' },
  PHARMACY_BEAUTY: { key: 'PHARMACY_BEAUTY', label: 'Pharmacy & Beauty', path: '/pharmacy', blurb: 'Health and self-care' },
}
export const verticalForPath = (path) => Object.values(VERTICALS).find((entry) => entry.path === path || (entry.key === 'FOOD' && path === '/restaurants'))

// Sub-category chips: matched against the store's cuisine, menu sections and item names (no invented data).
export const SUBCATEGORIES = {
  FOOD: [
    { key: 'local', label: 'Local food', words: ['local', 'nigerian', 'native', 'buka', 'eba', 'pounded', 'soup', 'egusi', 'banga', 'starch', 'owo', 'fufu', 'ofe', 'pepper soup', 'beans', 'porridge'] },
    { key: 'international', label: 'International', words: ['international', 'continental', 'chinese', 'italian', 'indian', 'lebanese', 'pasta', 'spaghetti', 'noodle', 'sushi', 'mexican', 'taco', 'stir fry', 'american', 'asian'] },
    { key: 'snacks', label: 'Snacks', words: ['snack', 'chips', 'crisps', 'popcorn', 'plantain chips', 'chin chin', 'doughnut', 'donut', 'biscuit'] },
    { key: 'chicken', label: 'Chicken', words: ['chicken', 'wings', 'turkey', 'drumstick'] },
    { key: 'shawarma', label: 'Shawarma', words: ['shawarma', 'wrap'] },
    { key: 'rice', label: 'Jollof', words: ['jollof', 'rice', 'fried rice', 'ofada'] },
    { key: 'amala', label: 'Amala', words: ['amala', 'ewedu', 'gbegiri', 'swallow', 'semo', 'semovita', 'pounded yam'] },
    { key: 'premium', label: 'Premium', words: ['premium', 'fine dining', 'lounge', 'grill house', 'steak', 'seafood', 'prawn', 'lobster'], premiumPriceMinor: 600000 },
    { key: 'burgers', label: 'Burgers', words: ['burger', 'sandwich', 'hot dog'] },
    { key: 'pizza', label: 'Pizza', words: ['pizza'] },
    { key: 'bakery', label: 'Bakery', words: ['bakery', 'bake', 'bread', 'cake', 'cupcake', 'pastry', 'pastries', 'croissant', 'meat pie', 'sausage roll', 'muffin'] },
    { key: 'icecream', label: 'Ice cream', words: ['ice cream', 'icecream', 'gelato', 'frozen', 'yoghurt', 'yogurt', 'sundae', 'milkshake'] },
    { key: 'smallchops', label: 'Small Chops', words: ['small chops', 'smallchops', 'puff puff', 'puff-puff', 'samosa', 'spring roll', 'gizdodo', 'peppered', 'asun'] },
    { key: 'healthy', label: 'Healthy', words: ['healthy', 'salad', 'fruit', 'smoothie', 'parfait', 'juice', 'vegan', 'vegetable', 'oat', 'wheat', 'diet', 'grilled fish'] },
    { key: 'grills', label: 'Suya & Grills', words: ['suya', 'grill', 'barbecue', 'bbq', 'kebab', 'kilishi', 'fish'] },
    { key: 'drinks', label: 'Drinks', words: ['drink', 'juice', 'smoothie', 'zobo', 'chapman', 'mocktail', 'water', 'soda', 'malt'] },
  ],
  GROCERIES: [
    { key: 'provisions', label: 'Provisions', words: ['provision', 'noodles', 'indomie', 'milk', 'sugar', 'tea', 'cereal', 'beverage'] },
    { key: 'staples', label: 'Rice, beans & oil', words: ['rice', 'beans', 'oil', 'garri', 'semovita', 'flour', 'yam', 'spaghetti'] },
    { key: 'fresh', label: 'Fresh produce', words: ['fresh', 'tomato', 'pepper', 'onion', 'vegetable', 'fruit', 'plantain', 'produce'] },
    { key: 'drinks', label: 'Drinks', words: ['drink', 'juice', 'water', 'soda', 'malt', 'beer', 'wine'] },
    { key: 'household', label: 'Household', words: ['detergent', 'soap', 'tissue', 'cleaning', 'household', 'bleach'] },
  ],
  SHOPS: [
    { key: 'phones', label: 'Phones & gadgets', words: ['phone', 'charger', 'earpiece', 'gadget', 'power bank', 'cable', 'accessor'] },
    { key: 'electronics', label: 'Electronics', words: ['electronic', 'tv', 'speaker', 'laptop', 'appliance', 'fan', 'bulb'] },
    { key: 'fashion', label: 'Fashion', words: ['fashion', 'cloth', 'shirt', 'dress', 'shoe', 'bag', 'wear', 'boutique'] },
    { key: 'home', label: 'Home & kitchen', words: ['home', 'kitchen', 'pot', 'plate', 'decor', 'bedding'] },
    { key: 'gifts', label: 'Gifts & stationery', words: ['gift', 'book', 'stationery', 'toy', 'card'] },
  ],
  PHARMACY_BEAUTY: [
    { key: 'medicine', label: 'Medicines', words: ['pharm', 'medic', 'drug', 'tablet', 'syrup', 'paracetamol', 'vitamin', 'first aid'] },
    { key: 'personal', label: 'Personal care', words: ['personal', 'toothpaste', 'deodorant', 'sanitary', 'pad', 'soap', 'lotion'] },
    { key: 'beauty', label: 'Beauty', words: ['beauty', 'cosmetic', 'makeup', 'hair', 'skin', 'perfume', 'cream', 'nail'] },
    { key: 'baby', label: 'Baby & mum', words: ['baby', 'diaper', 'nappy', 'formula', 'infant'] },
  ],
}
const haystack = (store) => [store.name, store.cuisine, store.description, ...(store.categories || []), ...(store.items || []).map((item) => `${item.name} ${item.category || ''}`)].join(' ').toLowerCase()
export const storeMatches = (store, sub) => { const text = haystack(store); return sub.words.some((word) => text.includes(word)) || (sub.premiumPriceMinor != null && (store.medianPriceMinor || 0) >= sub.premiumPriceMinor) }
export const storeSearch = (store, query) => { const words = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean); if (!words.length) return true; const text = haystack(store); return words.every((word) => text.includes(word)) }

// Home feed ------------------------------------------------------------------------------------------------------
let homeCache = null
let homePromise = null
const HOME_CHANGED = 'doorstep-home-change'
export function loadHome({ force = false } = {}) {
  if (!force && homeCache && Date.now() - homeCache.at < 60_000) return Promise.resolve(homeCache.body)
  if (!force && homePromise) return homePromise
  homePromise = fetch(`${apiBase}/api/app/home`, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} })
    .then(async (response) => { if (!response.ok) throw new Error('Stores are taking a moment to load. Pull to refresh or try again shortly.'); return response.json() })
    .then((body) => { homeCache = { at: Date.now(), body }; window.dispatchEvent(new Event(HOME_CHANGED)); return body })
    .finally(() => { homePromise = null })
  return homePromise
}
export function useHome() {
  const [state, setState] = useState(() => homeCache ? { status: 'ready', data: homeCache.body, error: '' } : { status: 'loading', data: null, error: '' })
  useEffect(() => {
    let active = true
    const sync = () => { if (active && homeCache) setState({ status: 'ready', data: homeCache.body, error: '' }) }
    window.addEventListener(HOME_CHANGED, sync)
    loadHome().then(sync).catch((error) => { if (active && !homeCache) setState({ status: 'error', data: null, error: error instanceof TypeError ? 'You seem to be offline. Check your connection and try again.' : error.message }) })
    return () => { active = false; window.removeEventListener(HOME_CHANGED, sync) }
  }, [])
  return { ...state, reload: () => { setState((current) => ({ ...current, status: current.data ? 'ready' : 'loading' })); return loadHome({ force: true }).catch((error) => setState({ status: 'error', data: null, error: error.message })) } }
}

export function useStorePage(slug) {
  const [state, setState] = useState({ status: 'loading', store: null, topSellerIds: [], reviews: [], error: '' })
  useEffect(() => {
    let active = true
    setState({ status: 'loading', store: null, topSellerIds: [], reviews: [], error: '' })
    fetch(`${apiBase}/api/app/stores/${encodeURIComponent(slug)}`)
      .then(async (response) => { const body = await response.json().catch(() => ({})); if (response.status === 404) throw new Error('This store isn’t on DOORSTEP right now.'); if (!response.ok) throw new Error('The store couldn’t load. Try again shortly.'); return body })
      .then((body) => { if (active) setState({ status: 'ready', store: body.store, topSellerIds: body.topSellerIds || [], reviews: body.reviews || [], reviewCount: body.reviewCount ?? (body.reviews || []).length, itemStats: body.itemStats || {}, error: '' }) })
      .catch((error) => { if (active) setState({ status: 'error', store: null, topSellerIds: [], reviews: [], error: error instanceof TypeError ? 'You seem to be offline.' : error.message }) })
    return () => { active = false }
  }, [slug])
  return state
}

// Ratings and timing shown on cards ------------------------------------------------------------------------------
/** Glovo-style: the share of reviewers who gave a thumbs-up (falls back to the average for older data). */
export const ratingPercent = (store) => !store?.ratingCount ? null : store.ratingLikes != null ? Math.round((store.ratingLikes / store.ratingCount) * 100) : Math.round((Number(store.rating) / 5) * 100)
export const etaText = (range) => range ? `${range[0]}–${range[1]} min` : ''
export const storeHref = (store) => `/store/${store.slug}`

// Cart -----------------------------------------------------------------------------------------------------------
export function useCart() {
  const [cart, setCart] = useState(() => loadCart())
  useEffect(() => {
    const sync = () => setCart(loadCart())
    window.addEventListener('doorstep-cart-change', sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('doorstep-cart-change', sync); window.removeEventListener('storage', sync) }
  }, [])
  const count = cart.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  return { cart, count, subtotal }
}
/** Adds one item. Returns 'OTHER_STORE' (and changes nothing) when the basket is from another store, unless `replace`. */
export function addItem(store, item, { replace = false } = {}) {
  const cart = loadCart()
  if (cart.length && cart[0].restaurantId !== store.id && !replace) return 'OTHER_STORE'
  const start = cart.length && cart[0].restaurantId !== store.id ? [] : cart
  const existing = start.find((entry) => entry.id === item.id)
  const next = existing ? start.map((entry) => entry.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry) : [...start, { id: item.id, name: item.name, price: item.price, image: item.image, description: item.description, quantity: 1, restaurantId: store.id, restaurantName: store.name, restaurantSlug: store.slug }]
  saveCart(next)
  return 'ADDED'
}
export function changeItem(id, delta) { saveCart(loadCart().map((entry) => entry.id === id ? { ...entry, quantity: entry.quantity + delta } : entry).filter((entry) => entry.quantity > 0)) }
export function setItemNote(id, instructions) { saveCart(loadCart().map((entry) => entry.id === id ? { ...entry, instructions: instructions.slice(0, 200) } : entry)) }
export function clearCart() { saveCart([]) }

// Address --------------------------------------------------------------------------------------------------------
const ADDRESS_CHANGED = 'doorstep-address-change'
export function currentAddress() {
  const point = readConfirmedLocation()
  const label = read('doorstep-location') || point?.label || ''
  return { label, point: point && Number.isFinite(point.latitude) ? { latitude: point.latitude, longitude: point.longitude } : null, savedAddressId: read('doorstep-address-id'), landmark: read('doorstep-location-landmark') || '' }
}
/** Sets the delivery address. A typed address without a pin is fine: the fee is then priced by its area. */
export function chooseAddress({ label, latitude, longitude, savedAddressId = null, landmark = null }) {
  write('doorstep-location', label)
  write('doorstep-address-id', savedAddressId)
  write('doorstep-location-landmark', landmark || null)
  try {
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) localStorage.setItem('doorstep-location-coordinates', JSON.stringify({ latitude, longitude, label }))
    else localStorage.removeItem('doorstep-location-coordinates')
  } catch { /* private mode */ }
  window.dispatchEvent(new Event(ADDRESS_CHANGED))
}
export function useAddress() {
  const [address, setAddress] = useState(currentAddress)
  useEffect(() => {
    const sync = () => setAddress(currentAddress())
    // The map page sets a fresh pin: it is no longer one of the saved addresses.
    const fromMap = () => { write('doorstep-address-id', null); sync() }
    window.addEventListener('doorstep-location-change', fromMap)
    window.addEventListener(ADDRESS_CHANGED, sync)
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    return () => { window.removeEventListener('doorstep-location-change', fromMap); window.removeEventListener(ADDRESS_CHANGED, sync); window.removeEventListener('storage', sync); window.removeEventListener('focus', sync) }
  }, [])
  return address
}

const checks = new Map()
export async function checkDelivery({ point, label }) {
  const key = point ? `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}` : `t:${label}`
  if (!point && String(label || '').trim().length < 3) return null
  if (checks.has(key)) return checks.get(key)
  const response = await fetch(`${apiBase}/api/delivery/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(point ? { latitude: point.latitude, longitude: point.longitude, addressLine: label || undefined } : { addressLine: label }) })
  if (!response.ok) return null
  const body = await response.json()
  checks.set(key, body)
  return body
}
export function useDeliveryCheck(address) {
  const [result, setResult] = useState(null)
  const key = address.point ? `${address.point.latitude},${address.point.longitude}` : address.label
  useEffect(() => {
    let active = true
    setResult(null)
    checkDelivery(address).then((body) => { if (active) setResult(body) }).catch(() => undefined)
    return () => { active = false }
  }, [key])
  return result
}

export function useSavedAddresses() {
  const [addresses, setAddresses] = useState([])
  useEffect(() => {
    if (!token()) return undefined
    let active = true
    fetch(`${apiBase}/api/addresses`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (active && body) setAddresses(body.addresses || []) }).catch(() => undefined)
    return () => { active = false }
  }, [])
  return addresses
}

// Tips -------------------------------------------------------------------------------------------------------------
export const savedTip = () => Number(read('doorstep-saved-tip', '0')) || 0
export const saveTip = (minor) => write('doorstep-saved-tip', minor ? String(minor) : null)

// Checkout quote -----------------------------------------------------------------------------------------------------
export function buildOrderRequest(cart, { orderType, address, scheduledFor, tipMinor, promoCode, landmark, phone, paymentMethod = 'PAYSTACK' }) {
  if (!cart.length) return null
  const base = { restaurantId: String(cart[0].restaurantId), items: cart.map((item) => ({ menuItemId: item.id, quantity: item.quantity, ...(item.instructions ? { instructions: item.instructions } : {}) })), paymentMethod, orderType, tipMinor: orderType === 'PICKUP' ? 0 : tipMinor || 0, ...(scheduledFor ? { scheduledFor } : {}), ...(promoCode ? { promoCode } : {}), ...(phone ? { phone } : {}), ...(landmark ? { landmark } : {}) }
  if (orderType === 'PICKUP') return base
  const line = String(address.label || '').trim()
  if (!address.point && line.length < 5) return null
  return { ...base, ...(address.savedAddressId && !address.point ? { addressId: address.savedAddressId } : {}), ...(line.length >= 5 ? { addressLine: line.slice(0, 240) } : {}), ...(address.point ? { latitude: Number(address.point.latitude), longitude: Number(address.point.longitude) } : {}) }
}

export function useCheckoutQuote(request) {
  const [state, setState] = useState({ status: 'idle', quote: null, error: '' })
  const key = useMemo(() => request ? JSON.stringify({ ...request, phone: undefined, landmark: undefined, paymentMethod: undefined }) : '', [request])
  useEffect(() => {
    if (!request) { setState({ status: 'idle', quote: null, error: '' }); return undefined }
    if (!token()) { setState({ status: 'signed-out', quote: null, error: '' }); return undefined }
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading', error: '' }))
    const timer = window.setTimeout(async () => {
      try {
        const { phone, landmark, ...priced } = request
        const response = await fetch(`${apiBase}/api/orders/validate`, { method: 'POST', signal: controller.signal, headers: authHeaders(), body: JSON.stringify({ ...priced, paymentMethod: 'PAYSTACK' }) })
        const body = await response.json().catch(() => ({}))
        if (response.status === 401) { setState({ status: 'signed-out', quote: null, error: '' }); return }
        if (!response.ok) throw new Error(body.message || 'We couldn’t price this order yet.')
        setState({ status: 'ready', quote: body, error: '' })
      } catch (error) { if (error.name !== 'AbortError') setState({ status: 'error', quote: null, error: error instanceof TypeError ? 'You seem to be offline.' : error.message }) }
    }, 350)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [key])
  return state
}

/** Creates the order, then sends the customer to pay. Returns the order id. */
export async function placeOrder(request, { idempotencyKey, savedCardId, saveCard }) {
  const orderResponse = await fetch(`${apiBase}/api/orders`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(request) })
  const orderBody = await orderResponse.json().catch(() => ({}))
  if (!orderResponse.ok) throw new Error(orderBody.message || 'We couldn’t place your order. Check the details and try again.')
  const orderId = orderBody.order.id
  if (request.paymentMethod === 'PAYSTACK' && savedCardId) {
    const charge = await fetch(`${apiBase}/api/payments/charge-saved-card`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ kind: 'order', id: orderId, cardId: savedCardId }) })
    const chargeBody = await charge.json().catch(() => ({}))
    if (charge.ok && chargeBody.status === 'SUCCESSFUL') { clearCart(); return { orderId, next: `/account/orders/${orderId}` } }
  }
  const paymentResponse = await fetch(`${apiBase}/api/payments/initialize`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ orderId, saveCard: Boolean(saveCard) }) })
  const paymentBody = await paymentResponse.json().catch(() => ({}))
  if (!paymentResponse.ok) throw Object.assign(new Error(paymentBody.message || 'Your order was saved, but payment couldn’t start. Open it from Orders to pay.'), { orderId })
  clearCart()
  if (paymentBody.paid) return { orderId, next: `/account/orders/${orderId}` }
  if (paymentBody.method === 'BANK_TRANSFER') return { orderId, next: `/payment/bank-transfer/${orderId}` }
  return { orderId, redirect: paymentBody.authorizationUrl }
}

// Appearance ---------------------------------------------------------------------------------------------------------
export const APPEARANCE_KEY = 'doorstep-appearance'
export function applyAppearance(value = read(APPEARANCE_KEY, 'light')) {
  const dark = value === 'dark' || (value === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.shopTheme = dark ? 'dark' : 'light'
}
export function setAppearance(value) { write(APPEARANCE_KEY, value); applyAppearance(value) }
export const appearance = () => read(APPEARANCE_KEY, 'light')

// Signed-in customer and their recent orders (for the greeting, the live order card and “Order again”) -------------
let meCache = null
export function useMe() {
  const [me, setMe] = useState(meCache)
  useEffect(() => {
    if (!token() || meCache) return undefined
    let active = true
    fetch(`${apiBase}/api/auth/me`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (body?.user) { meCache = body.user; if (active) setMe(body.user) } }).catch(() => undefined)
    return () => { active = false }
  }, [])
  return me
}
export const ACTIVE_ORDER_STATUSES = ['PAID', 'RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY']
export function useMyOrders() {
  const [orders, setOrders] = useState([])
  useEffect(() => {
    if (!token()) return undefined
    let active = true
    const load = () => { if (document.hidden) return; fetch(`${apiBase}/api/orders?limit=20`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (active && body?.orders) setOrders(body.orders) }).catch(() => undefined) }
    load()
    const timer = window.setInterval(load, 30_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  return orders
}
export function greeting(now = new Date()) {
  const hour = now.getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

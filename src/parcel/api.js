export const apiBase = globalThis.location?.hostname === 'mydoorstep.com.co' ? '' : import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export class ApiError extends Error {
  constructor(code, message, status, body) { super(message); this.code = code; this.status = status; this.body = body }
}

const friendly = {
  AUTHENTICATION_REQUIRED: 'Please sign in to continue.',
  SESSION_INVALID: 'Your session has expired. Please sign in again.',
  CUSTOMER_ROLE_REQUIRED: 'Package bookings are available on customer accounts.',
  QUOTE_RATE_LIMITED: 'Too many price checks. Wait a minute and try again.',
  ROUTING_NOT_CONFIGURED: 'Road routing is not configured yet, so prices cannot be calculated.',
  ROUTING_TOKEN_REJECTED: 'Road routing is misconfigured on the server. Please contact support.',
  ROUTING_PROVIDER_UNAVAILABLE: 'The routing service is not responding. Try again shortly.',
  PARCEL_BOOKINGS_DISABLED: 'Package delivery is not open yet. DOORSTEP has not published delivery fares.',
  PAYMENT_PROVIDER_NOT_CONFIGURED: 'Card payment is not available right now. Choose another method.',
  PAYMENT_SERVICE_UNAVAILABLE: 'Payment service is unavailable. Your booking is saved; try paying again shortly.',
  PAYMENT_INITIALIZATION_FAILED: 'Paystack could not start the payment. Your booking is saved; try again.',
}

export function token() {
  try { return localStorage.getItem('doorstep-token') } catch { return null }
}

export async function api(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const auth = token()
  let response
  try {
    response = await fetch(`${apiBase}${path}`, { method, signal, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError('NETWORK', 'You appear to be offline. Check your connection and try again.', 0)
  }
  let data = null
  try { data = await response.json() } catch { data = null }
  if (!response.ok) {
    const code = data?.error || `HTTP_${response.status}`
    throw new ApiError(code, friendly[code] || data?.message || 'Something went wrong. Please try again.', response.status, data)
  }
  return data
}

export const naira = (minor) => `₦${(Math.round(minor) / 100).toLocaleString('en-NG', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

export function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID ? `parcel-${globalThis.crypto.randomUUID()}` : `parcel-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export const statusOrder = ['PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'SEARCHING_FOR_RIDER', 'RIDER_ASSIGNED', 'RIDER_EN_ROUTE_TO_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED']
export const statusLabels = {
  PENDING_PAYMENT: 'Pending payment',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  SEARCHING_FOR_RIDER: 'Searching for rider',
  RIDER_ASSIGNED: 'Rider assigned',
  RIDER_EN_ROUTE_TO_PICKUP: 'Rider en route to pickup',
  PICKED_UP: 'Package picked up',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

const CART_KEY = 'doorstep-cart-v2'
const ORDERS_KEY = 'doorstep-orders'

export const ORDER_STATUSES = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  RESTAURANT_ACCEPTED: 'RESTAURANT_ACCEPTED',
  PREPARING: 'PREPARING',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  RIDER_ASSIGNED: 'RIDER_ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
}

export function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]')
  } catch {
    return []
  }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart))
}

export function loadOrders() {
  try {
    return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]')
  } catch {
    return []
  }
}

export function createLocalOrder({ cart, address, phone }) {
  if (!cart.length) throw new Error('Add an item before checking out.')

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const deliveryFee = cart[0].deliveryFee || 800
  const order = {
    id: `local-${Date.now()}`,
    orderNumber: `DSP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(Date.now()).slice(-6)}`,
    restaurantId: cart[0].restaurantId,
    restaurantName: cart[0].restaurantName,
    items: cart.map(({ id, name, price, quantity }) => ({ id, name, price, quantity })),
    subtotal,
    deliveryFee,
    serviceFee: Math.round(subtotal * 0.03),
    total: subtotal + deliveryFee + Math.round(subtotal * 0.03),
    address,
    phone,
    paymentStatus: 'PAID',
    status: ORDER_STATUSES.PAID,
    createdAt: new Date().toISOString(),
  }

  const orders = [order, ...loadOrders()]
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders))
  saveCart([])
  return order
}

const CART_KEY = 'doorstep-cart-v2'

export function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]')
  } catch {
    return []
  }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart))
  window.dispatchEvent(new Event('doorstep-cart-change'))
}

import { useEffect, useMemo, useState } from 'react'
import { apiBase } from '../config/apiBase'

// Live checkout price from the DOORSTEP server: the delivery fee depends on the road distance from the store to the
// customer's pin (or chosen Sapele area), so it is never worked out in the browser.
export function useDeliveryQuote(cart, { addressLine, latitude, longitude } = {}) {
  const [state, setState] = useState({ status: 'idle', quote: null, error: '' })
  const request = useMemo(() => {
    if (!cart?.length || !cart[0]?.restaurantId) return null
    const hasPoint = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && latitude !== '' && longitude !== '' && latitude != null && longitude != null
    const line = String(addressLine || '').trim()
    if (!hasPoint && line.length < 5) return null
    return {
      restaurantId: String(cart[0].restaurantId),
      items: cart.map((item) => ({ menuItemId: item.id, quantity: item.quantity })),
      paymentMethod: 'PAYSTACK',
      ...(line.length >= 5 ? { addressLine: line.slice(0, 240) } : {}),
      ...(hasPoint ? { latitude: Number(latitude), longitude: Number(longitude) } : {}),
    }
  }, [cart, addressLine, latitude, longitude])
  const key = request ? JSON.stringify(request) : ''

  useEffect(() => {
    if (!request) { setState({ status: 'idle', quote: null, error: '' }); return undefined }
    let token = null
    try { token = localStorage.getItem('doorstep-token') } catch { token = null }
    if (!token) { setState({ status: 'signed-out', quote: null, error: '' }); return undefined }
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading', error: '' }))
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiBase}/api/orders/validate`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(request) })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.message || 'We couldn’t price delivery to this address yet.')
        setState({ status: 'ready', quote: body, error: '' })
      } catch (error) {
        if (error.name !== 'AbortError') setState({ status: 'error', quote: null, error: error.message })
      }
    }, 450)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [key])

  return state
}

/** Totals in naira for display: the server quote when we have one, otherwise a clearly-labelled estimate. */
export function checkoutTotals(state, cart) {
  const subtotal = (cart || []).reduce((sum, item) => sum + item.price * item.quantity, 0)
  if (state.status === 'ready' && state.quote) {
    const quote = state.quote
    return { subtotal, delivery: quote.deliveryFeeMinor / 100, service: quote.serviceFeeMinor / 100, total: quote.totalMinor / 100, exact: true, details: quote.delivery || null }
  }
  return { subtotal, delivery: null, service: null, total: null, exact: false, details: null }
}

export function deliveryExplanation(details) {
  if (!details || details.pricing !== 'DISTANCE') return ''
  const where = details.basis === 'AREA' ? `centre of ${details.area}` : details.basis === 'TYPICAL_DISTANCE' ? 'a typical Sapele trip' : 'your map pin'
  const parts = [`${details.km} km by road to ${where}`]
  if (details.estimated && details.basis !== 'TYPICAL_DISTANCE') parts[0] = `about ${details.km} km to ${where}`
  if (details.basis === 'AREA' || details.basis === 'TYPICAL_DISTANCE') parts.push('pin your exact spot for the exact fee')
  if (details.boost) parts.push('busy-time fee included')
  return parts.join(' · ')
}

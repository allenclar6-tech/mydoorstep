import { useEffect, useState } from 'react'
import { Store } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Business switch: may customers order for pickup (collect at the counter, no rider, no delivery fee)?
const headers = () => { let token = null; try { token = localStorage.getItem('doorstep-token') } catch { token = null } return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }

export function PickupToggle() {
  const [enabled, setEnabled] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { fetch(`${apiBase}/api/restaurant/store-options`, { headers: headers() }).then((response) => response.ok ? response.json() : null).then((body) => { if (body) setEnabled(body.restaurant.pickupEnabled) }).catch(() => undefined) }, [])
  if (enabled == null) return null
  const toggle = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiBase}/api/restaurant/store-options`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ pickupEnabled: !enabled }) })
      if (!response.ok) throw new Error('Couldn’t save. Try again.')
      setEnabled(!enabled)
    } catch (toggleError) { setError(toggleError.message) } finally { setBusy(false) }
  }
  return <section className="rb-pickup">
    <Store size={18} aria-hidden="true" />
    <div><b>Customer pickup</b><small>{enabled ? 'Customers can order and collect at your counter. Mark “Customer collected it” when they do.' : 'Off — customers can only order delivery.'}</small>{error && <small className="rb-error">{error}</small>}</div>
    <button type="button" role="switch" aria-checked={enabled} aria-label="Customer pickup" className={`rb-switch${enabled ? ' is-on' : ''}`} disabled={busy} onClick={toggle}><span /></button>
  </section>
}

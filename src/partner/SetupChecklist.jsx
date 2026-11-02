import { useEffect, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Business dashboard: “Get ready for orders” checklist. Each step checks real data and links to where it’s done.
const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const get = async (path) => {
  let token = null
  try { token = localStorage.getItem('doorstep-token') } catch { token = null }
  const response = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return response.ok ? response.json() : null
}

export function SetupChecklist({ grocery = false }) {
  const [state, setState] = useState(null)
  useEffect(() => {
    let active = true
    Promise.all([get('/api/restaurant/profile'), get('/api/restaurant/menu'), get('/api/finance/withdrawal-options')]).then(([profile, menu, money]) => {
      if (!active) return
      const store = profile?.restaurant || {}
      const items = menu?.items || []
      setState({
        steps: [
          ['pin', 'Pin your shop on the map', 'So each customer pays the right delivery fee for their distance.', store.latitude != null && store.longitude != null, '/restaurant/profile'],
          ['hours', 'Set your opening hours', 'Customers can only order while you’re open.', Boolean(store.openingTime && store.closingTime), '/restaurant/profile'],
          ['prep', `Set your ${grocery ? 'packing' : 'preparation'} time`, 'Use a range like 30-45 so customers see an honest time.', Boolean(store.prepTimeMinutes), '/restaurant/profile'],
          ['items', `Add at least 3 ${grocery ? 'products' : 'menu items'}`, `${items.length} added so far.`, items.length >= 3, '/restaurant/menu'],
          ['photos', 'Add photos to your items', `${items.filter((item) => item.imageUrl).length} of ${items.length} have a photo. Items with photos sell more.`, items.length > 0 && items.every((item) => item.imageUrl), '/restaurant/menu'],
          ['bank', 'Add your bank account', 'So you can withdraw your earnings.', Boolean(money?.account), '/restaurant/earnings'],
        ],
      })
    }).catch(() => undefined)
    return () => { active = false }
  }, [grocery])
  if (!state) return null
  const done = state.steps.filter((step) => step[3]).length
  if (done === state.steps.length) return null
  return <section className="setup-list" aria-label="Get ready for orders">
    <header><div><b>Get ready for more orders</b><small>{done} of {state.steps.length} done</small></div><span className="setup-bar" aria-hidden="true"><i style={{ width: `${(done / state.steps.length) * 100}%` }} /></span></header>
    <ul>{state.steps.map(([key, title, hint, ok, href]) => <li key={key} className={ok ? 'is-done' : ''}>
      <button type="button" onClick={() => navigate(href)} disabled={ok}>
        <span className="setup-tick" aria-hidden="true">{ok ? <Check size={15} /> : null}</span>
        <span className="setup-text"><b>{title}</b>{!ok && <small>{hint}</small>}</span>
        {!ok && <ChevronRight size={18} aria-hidden="true" />}
      </button>
    </li>)}</ul>
  </section>
}

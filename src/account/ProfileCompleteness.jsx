import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { apiBase } from '../config/apiBase'

const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }

// Any successful write to the API can move a checklist item (profile, photo, address, phone or email
// verification, rider vehicle and documents, store details, menu items), so rather than every save
// handler remembering to announce itself, watch writes once and refresh the checklist shortly after.
// Background traffic (location pings, tracking, chat, notifications, address search) is ignored.
const ignoredWrites = /\/api\/(account\/completeness|notifications|support|chat|locations\/|orders\/track|rider\/availability-location|deliveries\/[^/]+\/location)/
let refreshTimer = null
function watchProfileWrites() {
  if (typeof window === 'undefined' || window.__doorstepProfileWatch) return
  window.__doorstepProfileWatch = true
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const request = originalFetch(input, init)
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    if (method !== 'GET' && method !== 'HEAD' && url.includes('/api/') && !ignoredWrites.test(url)) {
      request.then((response) => {
        if (!response.ok) return
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => window.dispatchEvent(new Event('doorstep-profile-change')), 400)
      }, () => undefined)
    }
    return request
  }
}

/** Loads the signed-in user's completeness checklist from the API (computed from real account data). */
export function useProfileCompleteness() {
  const [state, setState] = useState({ loading: true, data: null })
  useEffect(() => {
    watchProfileWrites()
    let active = true
    const token = (() => { try { return localStorage.getItem('doorstep-token') } catch { return null } })()
    if (!token) { setState({ loading: false, data: null }); return undefined }
    const load = () => fetch(`${apiBase}/api/account/completeness`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setState({ loading: false, data }) })
      .catch(() => { if (active) setState({ loading: false, data: null }) })
    load()
    // Refresh when the person comes back from completing an item on another screen.
    const onVisible = () => { if (!document.hidden) load() }
    window.addEventListener('popstate', load)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('doorstep-profile-change', load)
    window.addEventListener('doorstep-profile-photo-change', load)
    return () => { active = false; window.removeEventListener('popstate', load); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('doorstep-profile-change', load); window.removeEventListener('doorstep-profile-photo-change', load) }
  }, [])
  return state
}

function Ring({ percent }) {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  return <svg className="pc-ring" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r={radius} className="pc-ring-track" />
    <circle cx="32" cy="32" r={radius} className="pc-ring-value" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} />
    <text x="32" y="36" textAnchor="middle">{percent}%</text>
  </svg>
}

/**
 * Profile completeness card: progress ring, the next most useful step, and the full checklist on demand.
 * Hidden for admins and once everything is done (unless `showWhenComplete`).
 */
export function ProfileCompletenessCard({ showWhenComplete = false, defaultOpen = false, className = '' }) {
  const { loading, data } = useProfileCompleteness()
  const [open, setOpen] = useState(defaultOpen)
  if (loading || !data || !data.items?.length) return null
  if (data.complete && !showWhenComplete) return null
  const doneCount = data.items.filter((entry) => entry.done).length
  return <section className={`pc-card${data.complete ? ' is-complete' : ''} ${className}`.trim()} aria-label="Profile completeness">
    <div className="pc-head">
      <Ring percent={data.percent} />
      <div className="pc-head-text">
        <strong>{data.complete ? 'Your profile is complete' : 'Complete your profile'}</strong>
        <span>{data.complete ? 'Everything is set up. Nice.' : `${doneCount} of ${data.items.length} done${data.next ? ` · Next: ${data.next.label.toLowerCase()}` : ''}`}</span>
      </div>
      <button type="button" className="pc-toggle" aria-expanded={open} aria-label={open ? 'Hide checklist' : 'Show checklist'} onClick={() => setOpen((value) => !value)}><ChevronDown size={18} /></button>
    </div>
    <div className="pc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.percent} aria-label="Profile complete"><i style={{ width: `${data.percent}%` }} /></div>
    {!open && data.next && <button type="button" className="pc-next" onClick={() => navigate(data.next.href)}><Sparkles size={16} aria-hidden="true" /><span><strong>{data.next.label}</strong><small>{data.next.hint}</small></span><ChevronRight size={16} aria-hidden="true" /></button>}
    {open && <ul className="pc-list">
      {data.items.map((entry) => <li key={entry.key}>
        <button type="button" className={entry.done ? 'pc-item is-done' : 'pc-item'} disabled={entry.done} onClick={() => navigate(entry.href)}>
          <span className="pc-check" aria-hidden="true">{entry.done && <Check size={13} strokeWidth={3} />}</span>
          <span className="pc-item-text"><strong>{entry.label}</strong>{!entry.done && <small>{entry.hint}</small>}</span>
          {!entry.done && <ChevronRight size={16} aria-hidden="true" />}
          <span className="sr-only">{entry.done ? 'Done' : 'Not done'}</span>
        </button>
      </li>)}
    </ul>}
  </section>
}

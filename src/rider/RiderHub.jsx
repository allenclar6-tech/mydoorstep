import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Bell, Bike, Clock3, MapPin, MessageCircle, Package, Power, ShieldCheck, User, Wallet as WalletIcon } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { MapPinArt, MoneyBag, Parcel, PhoneOrders, Scooter } from '../shop/Illustrations'
import { authHeaders, firstNameOf, usePolling, WorkspaceFrame } from '../workspace/WorkspaceFrame'

// Rider workspace frame + the big "Go online" card. Same frame as partners.

const RiderContext = createContext({ summary: null, summaryError: '', user: null, reload: async () => undefined })
export const useRider = () => useContext(RiderContext)

function useRiderData() {
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [user, setUser] = useState(null)
  const reload = useCallback(() => fetch(`${apiBase}/api/rider/summary`, { headers: authHeaders() }).then(async (response) => {
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.message || 'Couldn’t load your rider details.')
    setSummary(body); setSummaryError('')
  }).catch((error) => setSummaryError(error instanceof TypeError ? 'We can’t reach DOORSTEP. Check your internet — we’ll keep trying.' : error.message)), [])
  usePolling(reload)
  useEffect(() => { fetch(`${apiBase}/api/auth/me`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (body?.user) setUser(body.user) }).catch(() => undefined) }, [])
  return { summary, summaryError, user, reload }
}

export function riderStatus(summary) {
  if (!summary) return { tone: 'muted', label: 'Loading…', detail: '' }
  if (summary.approval !== 'APPROVED') return { tone: 'muted', label: 'Not approved yet', detail: 'DOORSTEP is checking your details' }
  if (summary.activeDeliveries > 0) return { tone: 'open', label: 'On a delivery', detail: summary.availability === 'ONLINE' ? 'Online' : 'Finishing up' }
  if (summary.availability === 'ONLINE') return { tone: 'open', label: 'Online', detail: 'Getting job requests' }
  return { tone: 'closed', label: 'Offline', detail: 'Not getting jobs' }
}

const PAGE_TITLES = { '/rider/price-checks': 'Price checks', '/rider/deliveries': 'Find jobs', '/rider/history': 'Trip history', '/rider/earnings': 'Earnings', '/rider/locations': 'Local checks', '/rider/verification': 'Verification', '/rider/account': 'My account', '/rider/settings': 'My account', '/rider/support': 'Help', '/rider/security': 'Sign-in & security', '/rider/notifications': 'Notifications' }

export function RiderShell({ path, children }) {
  const data = useRiderData()
  const isHome = path === '/rider/dashboard' || path === '/rider' || path === '/rider/'
  const user = data.user
  const name = user ? `${firstNameOf(user)} ${user.lastName || ''}`.trim() : 'Rider'
  const nav = [
    { label: 'Today', href: '/rider/dashboard', icon: Bike, active: isHome },
    { label: 'Jobs', href: '/rider/deliveries', icon: Package, active: path === '/rider/deliveries', count: data.summary?.activeDeliveries || 0 },
    { label: 'Earnings', href: '/rider/earnings', icon: WalletIcon, active: path === '/rider/earnings' },
    { label: 'History', href: '/rider/history', icon: Clock3, active: path === '/rider/history' },
    { label: 'My account', href: '/rider/account', icon: User, active: path === '/rider/account' || path === '/rider/settings' },
  ]
  const extra = [{ label: 'Price checks', href: '/rider/price-checks', icon: WalletIcon }, { label: 'Local checks', href: '/rider/locations', icon: MapPin }, { label: 'Verification', href: '/rider/verification', icon: ShieldCheck }, { label: 'Notifications', href: '/rider/notifications', icon: Bell }, { label: 'Help chat', href: '/rider/support', icon: MessageCircle }]
  return <RiderContext.Provider value={data}>
    <WorkspaceFrame path={path} home="/rider/dashboard" brandSub="Rider" label="Rider" name={name} image={user?.avatarUrl || user?.image || null}
      status={riderStatus(data.summary)} nav={nav} extra={extra} account={{ label: 'My account', href: '/rider/account' }} title={PAGE_TITLES[path]}
      greetingName={firstNameOf(user)} withdrawHref="/rider/earnings" isHome={isHome}>{children}</WorkspaceFrame>
  </RiderContext.Provider>
}

function onlineFor(since, now) {
  if (!since) return ''
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000))
  if (minutes < 1) return 'Online just now'
  if (minutes < 60) return `Online for ${minutes} min`
  return `Online for ${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The big "Go online" card. One tap; it never shows a change the server didn’t confirm. */
export function OnlineHero({ online, onlineSince, approved, loading, busy, onToggle }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!online) return undefined; const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer) }, [online])
  const tone = loading ? 'muted' : !approved && !online ? 'muted' : online ? 'open' : 'closed'
  const headline = loading ? 'Checking…' : !approved && !online ? 'Almost there' : online ? 'You’re online' : 'You’re offline'
  const copy = loading ? 'One moment.' : !approved && !online ? 'You can go online as soon as DOORSTEP approves your rider account. We’ll send you a message.' : online ? `${onlineFor(onlineSince, now) || 'Online'}. New job requests will pop up on this screen.` : 'Go online to start getting delivery jobs near you.'
  return <section className={`ph-hero is-${tone}`} aria-live="polite">
    <div className="ph-hero-copy">
      <span className="ph-pill"><i aria-hidden="true" />{loading ? 'Loading' : online ? 'Online' : approved ? 'Offline' : 'Waiting for approval'}</span>
      <h2>{headline}</h2>
      <p>{copy}</p>
      <div className="ph-hero-actions">
        <button type="button" role="switch" aria-checked={online} className={`ph-btn ${online ? 'is-ghost' : 'is-sun is-big'}`} disabled={loading || busy || (!approved && !online)} onClick={onToggle}>
          <Power size={18} aria-hidden="true" />{busy ? (online ? 'Going offline…' : 'Going online…') : online ? 'Go offline' : 'Go online'}
        </button>
      </div>
    </div>
    <div className="ph-hero-art is-ride" aria-hidden="true"><Scooter /></div>
  </section>
}

export const riderShortcuts = [
  { art: Parcel, title: 'Find jobs', hint: 'Open deliveries near you', href: '/rider/deliveries', tone: 'sun' },
  { art: MoneyBag, title: 'Earnings', hint: 'Balance and withdrawals', href: '/rider/earnings', tone: 'mint' },
  { art: MapPinArt, title: 'Local checks', hint: 'Help confirm places in Sapele', href: '/rider/locations', tone: 'sky' },
  { art: PhoneOrders, title: 'Get help', hint: 'Chat with the DOORSTEP team', href: '/rider/support', tone: 'rose' },
]

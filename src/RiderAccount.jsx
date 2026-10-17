import { useEffect, useState } from 'react'
import { Bell, Bike, Check, Headphones, MapPin, ShieldCheck, UserCircle } from 'lucide-react'
import { SessionSignOutButton } from './authControls'
import './riderAccount.css'

const apiBase = globalThis.location?.hostname === 'mydoorstep.com.co' ? '' : import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const sections = [['profile', 'Account profile', UserCircle], ['rider', 'Rider record', Bike], ['notifications', 'Notifications', Bell], ['support', 'Help & security', ShieldCheck]]

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}/api/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error === 'RIDER_PROFILE_NOT_FOUND' ? 'Your rider record is unavailable. Contact DOORSTEP support.' : body.error || 'This rider account request could not be completed.')
  return body
}

export function RiderAccount({ initialSection = 'profile' }) {
  const [section, setSection] = useState(initialSection)
  const [data, setData] = useState(null)
  const [notifications, setNotifications] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setError('')
    try {
      const [account, profile] = await Promise.all([request('auth/me'), request('rider/profile')])
      setData({ user: account.user, rider: profile.rider })
    } catch (loadError) { setError(loadError.message) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => { setSection(initialSection) }, [initialSection])
  useEffect(() => {
    if (section !== 'notifications') return
    let active = true
    request('notifications').then(body => { if (active) setNotifications(body.notifications || []) }).catch(loadError => { if (active) setError(loadError.message) })
    return () => { active = false }
  }, [section])

  const saveProfile = async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget))
      const body = await request('auth/me', { method: 'PATCH', body: JSON.stringify(values) })
      setData(current => ({ ...current, user: body.user }))
      setMessage('Rider account details saved.')
    } catch (saveError) { setError(saveError.message) } finally { setBusy(false) }
  }
  const toggleAvailability = async () => {
    if (!data || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const availability = data.rider.availability === 'ONLINE' ? 'OFFLINE' : 'ONLINE'
      const body = await request('rider/availability', { method: 'PATCH', body: JSON.stringify({ availability }) })
      setData(current => ({ ...current, rider: { ...current.rider, availability: body.rider.availability } }))
      setMessage(`You are now ${body.rider.availability.toLowerCase()}.`)
    } catch (availabilityError) { setError(availabilityError.message) } finally { setBusy(false) }
  }
  const markRead = async id => {
    setBusy(true); setError('')
    try {
      const body = await request(`notifications/${id}/read`, { method: 'PATCH' })
      if (!body.updated) throw new Error('This notification could not be updated.')
      setNotifications(current => current.map(item => item.id === id ? { ...item, readAt: new Date().toISOString() } : item))
    } catch (markError) { setError(markError.message) } finally { setBusy(false) }
  }

  if (!data) return <section className="rider-account-card"><h2>Your rider account</h2>{error ? <><p role="alert">{error}</p><button className="portal-primary" onClick={load}>Try again</button></> : <p role="status">Loading your rider account...</p>}</section>
  const { user, rider } = data
  return <div className="rider-account">
    <section className="rider-account-hero"><div className="rider-account-emblem"><Bike size={46} /></div><div><span className="section-kicker">DOORSTEP RIDER ACCOUNT</span><h2>{user.firstName} {user.lastName}</h2><p><MapPin size={16} />{rider.network === 'BUSINESS_OWNED' ? rider.restaurant?.name || 'Business rider network' : 'DOORSTEP rider network'}</p><span className="rider-account-status"><ShieldCheck size={15} />{rider.status.replaceAll('_', ' ')}</span></div><button className={rider.availability === 'ONLINE' ? 'rider-availability online' : 'rider-availability'} disabled={busy || rider.status !== 'APPROVED'} onClick={toggleAvailability}>{rider.availability === 'ONLINE' ? 'Online' : 'Go online'}</button></section>
    <div className="rider-account-layout">
      <nav className="rider-account-tabs" aria-label="Rider account settings">{sections.map(([id, label, Icon]) => <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => { setSection(id); setError(''); setMessage('') }}><Icon size={20} />{label}</button>)}<SessionSignOutButton /></nav>
      <section className="rider-account-card">
        {error && <p className="admin-login-error" role="alert">{error}</p>}{message && <p className="rider-save-message" role="status"><Check size={17} />{message}</p>}
        {section === 'profile' && <><span className="section-kicker">RIDER IDENTITY</span><h2>Account profile</h2><p>Keep the contact details used by DOORSTEP operations current.</p><form onSubmit={saveProfile}><div className="form-row"><label>First name<input required name="firstName" maxLength={80} defaultValue={user.firstName} /></label><label>Last name<input required name="lastName" maxLength={80} defaultValue={user.lastName} /></label></div><label>Phone number<input required name="phone" type="tel" minLength={7} maxLength={30} defaultValue={user.phone || ''} /></label><label>Sign-in email<input readOnly value={user.email} /></label><button className="portal-primary" disabled={busy}>{busy ? 'Saving...' : 'Save account details'}</button></form></>}
        {section === 'rider' && <><span className="section-kicker">DELIVERY READINESS</span><h2>Rider record</h2><p>Vehicle and verification details are reviewed by DOORSTEP operations for customer safety.</p><dl className="rider-record-list"><div><dt>Availability</dt><dd>{rider.availability}</dd></div><div><dt>Vehicle type</dt><dd>{rider.vehicleType || 'Not recorded'}</dd></div><div><dt>Vehicle details</dt><dd>{rider.vehicleDetails || 'Not recorded'}</dd></div><div><dt>Verification</dt><dd>{rider.status.replaceAll('_', ' ')}</dd></div><div><dt>Rating</dt><dd>{rider.ratingCount ? `${Number(rider.ratingAverage).toFixed(1)} from ${rider.ratingCount} ratings` : 'No ratings yet'}</dd></div></dl></>}
        {section === 'notifications' && <><span className="section-kicker">RIDER UPDATES</span><h2>Notifications</h2>{notifications === null ? <p role="status">Loading notifications...</p> : notifications.length === 0 ? <p>No notifications yet. Delivery, payout, and account updates will appear here.</p> : <ul className="rider-notifications">{notifications.map(item => <li key={item.id}><strong>{item.title}</strong><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small>{!item.readAt && <button disabled={busy} onClick={() => markRead(item.id)}>Mark as read</button>}</li>)}</ul>}</>}
        {section === 'support' && <><span className="section-kicker">SAFE DELIVERY SUPPORT</span><h2>Help & security</h2><div className="rider-security-note"><ShieldCheck size={28} /><p>Your identity, active-delivery access, and location sharing are protected by role-checked DOORSTEP services.</p></div><div className="rider-account-links"><a href="/forgot-password">Reset your password</a><a href="/contact"><Headphones size={18} />Contact rider support</a><a href="/rider-terms">Rider terms</a><a href="/privacy">Privacy policy</a></div><SessionSignOutButton className="portal-primary" /></>}
      </section>
    </div>
  </div>
}

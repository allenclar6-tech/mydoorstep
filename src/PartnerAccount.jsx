import { useEffect, useState } from 'react'
import { Bell, Check, Clock3, Headphones, MapPin, ShieldCheck, Store, UserCircle } from 'lucide-react'
import { SessionSignOutButton } from './authControls'
import './partnerAccount.css'
import { PartnerImageUpload } from './PartnerImageUpload'
import { ProfileAvatar } from './ProfileAvatar'
import { apiBase } from './config/apiBase'
import { TimeSelect } from './TimeSelect'

const sections = [['business', 'Business profile', Store], ['owner', 'Account details', UserCircle], ['operations', 'Store operations', Clock3], ['notifications', 'Notifications', Bell], ['support', 'Help & security', ShieldCheck]]

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${apiBase}/api/${path}`, { ...options, headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(20_000) })
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? 'The service took too long to respond. Please try again.' : 'Could not connect. Check your internet connection and try again.')
  }
  const body = await response.json()
  if (!response.ok) {
    const messages = { INVALID_RESTAURANT_PROFILE: 'Check the business name, address and contact details.', INVALID_PROFILE: 'Check your name and phone number.', PHONE_ALREADY_IN_USE: 'This phone number is already used by another account.' }
    throw new Error(messages[body.error] || (response.status === 401 ? 'Your session expired. Sign out and sign in again.' : response.status === 403 ? 'You do not have permission to access these business settings.' : 'The service is unavailable. Please try again.'))
  }
  return body
}

export function PartnerAccount({ initialSection = 'business' }) {
  const [section, setSection] = useState(initialSection)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notifications, setNotifications] = useState(null)
  useEffect(() => { setSection(initialSection) }, [initialSection])
  const load = async () => {
    setError('')
    try {
      const [profile, account] = await Promise.all([request('restaurant/profile'), request('auth/me')])
      if (!profile.restaurant || !account.user) throw new Error('Your business profile could not be found. Contact support.')
      setData({ restaurant: profile.restaurant, user: account.user })
    } catch (error) { setError(error.message) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (section !== 'notifications') return
    let active = true
    setError('')
    request('notifications').then(body => { if (active) setNotifications(body.notifications || []) }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [section])
  const save = async event => {
    event.preventDefault()
    if (busy) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true); setError(''); setMessage('')
    try {
      const business = section === 'business'
      const body = await request(business ? 'restaurant/profile' : 'auth/me', { method: 'PATCH', body: JSON.stringify(business ? values : { ...values, ...(data.user.dateOfBirth ? { dateOfBirth: data.user.dateOfBirth.slice(0, 10) } : {}) }) })
      if (!(business ? body.restaurant : body.user)) throw new Error('The service did not confirm your saved changes. Reload your profile to check before trying again.')
      setData(current => ({ ...current, [business ? 'restaurant' : 'user']: business ? body.restaurant : body.user }))
      setMessage(business ? 'Business profile saved.' : 'Account details saved.')
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  const markRead = async id => {
    setBusy(true); setError('')
    try { const body = await request(`notifications/${id}/read`, { method: 'PATCH' }); if (!body.updated) throw new Error('This notification could not be updated. Refresh and try again.'); setNotifications(current => current.map(item => item.id === id ? { ...item, readAt: new Date().toISOString() } : item)) } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  if (!data) return <section className="partner-account-card" aria-live="polite"><h2>Your partner account</h2>{error ? <><p role="alert">{error}</p><button className="portal-primary" onClick={load}>Try again</button></> : <p role="status">Loading your business and account details...</p>}</section>
  const { restaurant, user } = data
  const grocery = restaurant.storeType === 'GROCERY'
  return <div className="partner-account">
    <section className="partner-account-hero"><div className="partner-store-emblem" aria-hidden="true"><ProfileAvatar size={48} /></div><div><span className="section-kicker">{grocery ? 'GROCERY' : 'RESTAURANT'} PARTNER ACCOUNT</span><h2>{restaurant.name}</h2><p><MapPin size={16} />{restaurant.address}</p><span className="partner-account-status"><ShieldCheck size={15} />{restaurant.status?.replaceAll('_', ' ') || 'Status unavailable'}</span></div></section>
    <PartnerImageUpload label={grocery ? 'Grocery store logo' : 'Restaurant logo'} logo endpoint="/api/restaurant/logo" imageEndpoint="/api/profile/photo" />
    <div className="partner-account-layout">
      <nav className="partner-account-tabs" aria-label="Partner account settings">{sections.map(([id, label, Icon]) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => { setSection(id); setError(''); setMessage('') }}><Icon size={20} /><span>{label}</span></button>)}<SessionSignOutButton /></nav>
      <section className="partner-account-card">
        {error && <p className="admin-login-error" role="alert">{error}</p>}{message && <p className="partner-save-message" role="status"><Check size={17} />{message}</p>}
        {section === 'business' && <><span className="section-kicker">YOUR STOREFRONT</span><h2>Business profile</h2><p>Keep the details customers use to find and contact your store up to date.</p><form key="business" onSubmit={save}><label>Business name<input required name="name" minLength={2} maxLength={120} defaultValue={restaurant.name} /></label><label>Business description<textarea name="description" maxLength={500} rows={4} defaultValue={restaurant.description || ''} /></label><label>Business phone<input name="phone" type="tel" maxLength={30} defaultValue={restaurant.phone || ''} /></label><label>Business address<input required name="address" minLength={5} maxLength={240} defaultValue={restaurant.address} /></label><div className="form-row"><label>Opening time<TimeSelect name="openingTime" label="Opening time" defaultValue={restaurant.openingTime || ''} /></label><label>Closing time<TimeSelect name="closingTime" label="Closing time" defaultValue={restaurant.closingTime || ''} /></label></div><label>{grocery ? 'Product fulfillment time (minutes)' : 'Order preparation time (minutes)'}<input name="prepTimeMinutes" type="number" min="1" max="240" step="1" defaultValue={restaurant.prepTimeMinutes || ''} /></label><small>Set both opening and closing times, or leave both empty. Changes apply to the customer storefront.</small><button className="portal-primary" disabled={busy}>{busy ? 'Saving...' : 'Save business profile'}</button></form></>}
        {section === 'owner' && <><span className="section-kicker">PARTNER IDENTITY</span><h2>Account details</h2><p>Your personal contact details are separate from the store profile.</p><PartnerImageUpload label={grocery ? 'Grocery owner profile picture' : 'Owner profile picture'} endpoint="/api/profile/photo" imageEndpoint="/api/profile/photo" profile /><form key="owner" onSubmit={save}><div className="form-row"><label>First name<input required name="firstName" maxLength={80} defaultValue={user.firstName} /></label><label>Last name<input required name="lastName" maxLength={80} defaultValue={user.lastName} /></label></div><label>Phone number<input required type="tel" name="phone" minLength={7} maxLength={30} defaultValue={user.phone} /></label><label>Sign-in email<input readOnly value={user.email} /></label><small>Contact support if your sign-in email needs to change.</small><button className="portal-primary" disabled={busy}>{busy ? 'Saving...' : 'Save account details'}</button></form></>}
        {section === 'operations' && <><span className="section-kicker">BUSINESS CONTROLS</span><h2>Store operations</h2><p>Hours and fulfillment settings can be updated in the business profile. Approval changes remain managed by the DOORSTEP operations team.</p><dl className="partner-operation-list"><div><dt>Store type</dt><dd>{grocery ? 'Grocery store' : 'Restaurant'}</dd></div><div><dt>Opening time</dt><dd>{restaurant.openingTime || 'Not configured'}</dd></div><div><dt>Closing time</dt><dd>{restaurant.closingTime || 'Not configured'}</dd></div><div><dt>{grocery ? 'Fulfillment time' : 'Preparation time'}</dt><dd>{restaurant.prepTimeMinutes ? `${restaurant.prepTimeMinutes} minutes` : 'Not configured'}</dd></div><div><dt>Approval status</dt><dd>{restaurant.status?.replaceAll('_', ' ') || 'Not available'}</dd></div></dl><div className="partner-account-links"><a href="/restaurant/menu">Manage {grocery ? 'products' : 'menu'}</a><a href="/restaurant/orders">Manage orders</a><a href="/restaurant/earnings">{grocery ? 'Store earnings' : 'Sales & earnings'}</a></div></>}
        {section === 'notifications' && <><span className="section-kicker">BUSINESS UPDATES</span><h2>Notifications</h2>{notifications === null ? <p role="status">Loading notifications...</p> : notifications.length === 0 ? <p>No notifications yet. New account and business updates will appear here.</p> : <ul className="partner-notifications">{notifications.map(item => <li key={item.id}><strong>{item.title}</strong><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small>{!item.readAt && <button disabled={busy} onClick={() => markRead(item.id)}>Mark as read</button>}</li>)}</ul>}</>}
        {section === 'support' && <><span className="section-kicker">HERE FOR YOUR BUSINESS</span><h2>Help & security</h2><div className="partner-security-note"><ShieldCheck size={28} /><p>Your workspace is protected by role-checked access. Approval and payment permissions remain controlled by DOORSTEP.</p></div><div className="partner-account-links"><a href="/forgot-password">Reset your password</a><a href="/contact"><Headphones size={18} />Contact DOORSTEP support</a><a href="/restaurant-partner-terms">Partner terms</a><a href="/privacy">Privacy policy</a></div><p>Sign out when using a shared device. You will return to partner login, not the customer account.</p><SessionSignOutButton className="portal-primary" /></>}
      </section>
    </div>
  </div>
}

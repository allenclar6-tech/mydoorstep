import { useEffect, useState } from 'react'
import { ArrowRight, Check, Shield } from 'lucide-react'
import { formatNaira } from './data'
import { PasswordField } from './PasswordField'
import { lockedUntilTouched, useManualSignIn } from './auth/manualSignIn'
import { ApplicationManagement } from './ApplicationManagement'
import { AdminParcels } from './admin/AdminParcels'
import { WorkspaceInbox } from './notifications/NotificationCenter'
import { AdminHome, AdminShell } from './admin/AdminHub'
import { SupportDesk } from './admin/SupportDesk'
import { FinanceAdmin } from './admin/FinanceAdmin'
import { DeliveryPricingAdmin } from './admin/DeliveryPricing'
import { PaymentSettingsAdmin } from './admin/PaymentSettings'
import { LocationsAdmin } from './admin/LocationsAdmin'
import { PromosAdmin } from './admin/PromosAdmin'
import { PushPrompt } from './notifications/PushPrompt'
import { InstallApp } from './app/InstallApp'
import { AdminAppDownload } from './admin/AdminAppDownload'
import { ConfirmDeliveredButton, DispatchBoard } from './admin/DispatchBoard'
import { SessionSignOutButton, SignOutNotice } from './authControls'
import { apiBase } from './config/apiBase'

const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }

export function AdminLogin({ onLogin }) {
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const manual = useManualSignIn()
	const submit = async (event) => {
		if (!manual.allowSubmit(event)) return
		event.preventDefault()
		setBusy(true)
		setError('')
		const form = new FormData(event.currentTarget)
		try {
			const response = await fetch(`${apiBase}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), password: form.get('password') }), signal: AbortSignal.timeout(20_000) })
			const body = await response.json().catch(() => ({}))
			if (!response.ok || body.user?.role !== 'ADMIN') throw new Error(body.user ? 'This account does not have admin access.' : 'Invalid admin credentials.')
			localStorage.setItem('doorstep-admin-token', body.token)
			onLogin()
		} catch (loginError) { setError(loginError.name === 'TimeoutError' ? 'The sign-in service did not respond. Please try again.' : loginError.message || 'Unable to sign in. Please try again.') } finally { setBusy(false) }
	}
	return <main className="admin-login-page"><div className="admin-login-card"><div className="admin-brand"><span className="brand-mark">✦</span><span>doorstep<small>control center</small></span></div><span className="section-kicker">OWNER ACCESS</span><h1>Admin control center</h1><p>Sign in with the business owner account. Normal customer, partner, and rider accounts cannot enter this workspace.</p><SignOutNotice /><form onSubmit={submit} {...manual.formProps}><label>Email address<input required type="email" name="email" autoComplete="username" {...lockedUntilTouched} /></label><PasswordField required label="Password" name="password" autoComplete="current-password" {...lockedUntilTouched} />{error && <div className="admin-login-error" role="alert">{error}</div>}<button className="admin-primary" disabled={busy} type="submit">{busy ? 'Signing in...' : 'Sign in to admin'} <ArrowRight size={16} /></button><button className="forgot-password-link" type="button" onClick={() => navigate('/admin/forgot-password')}>Forgot password?</button></form><a className="forgot-password-link admin-app-link" href="/admin/download" onClick={(event) => { event.preventDefault(); navigate('/admin/download') }}>📱 Get the DOORSTEP Admin app</a></div></main>
}

// Page titles now live in the top bar and the “How this page works” guide (admin/AdminHub.jsx).
function AdminIntro() { return null }
function Stat({ label, value, note }) { return <div className="admin-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div> }

function LiveAdminOrders() { const [orders, setOrders] = useState([]); const [message, setMessage] = useState('');  const token = localStorage.getItem('doorstep-admin-token'); useEffect(() => { fetch(`${apiBase}/api/admin/orders`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load admin orders.'); setOrders(body.orders || []) }).catch((error) => setMessage(error.message)) }, []); return <><AdminIntro eyebrow="ORDER OPERATIONS" title="Every order, one view." />{message && <div className="admin-login-error">{message}</div>}<section className="admin-table"><div className="admin-table-head"><input placeholder="Search order number..." /><select defaultValue="all"><option value="all">All statuses</option><option value="PAID">Paid</option><option value="OUT_FOR_DELIVERY">Out for delivery</option><option value="DELIVERED">Delivered</option><option value="CANCELLED">Cancelled</option></select></div>{orders.length === 0 && !message ? <div className="empty-state">No orders found.</div> : orders.map((order) => <div className="admin-table-row order-admin-row" key={order.id}><div><strong>{order.orderNumber}</strong><small>{order.customer?.firstName} {order.customer?.lastName} · {order.restaurant?.name} · {order.rider ? `${order.rider.user.firstName} ${order.rider.user.lastName}` : 'Awaiting rider'}</small></div><span className="admin-pill active">{order.status}</span><strong>{formatNaira(Math.round(order.totalMinor / 100))}</strong><span className="admin-review">{order.payment?.status || 'PENDING'}</span></div>)}</section></> }

function Finance() { const [summary, setSummary] = useState(null); const [message, setMessage] = useState('');  const token = localStorage.getItem('doorstep-admin-token'); useEffect(() => { fetch(`${apiBase}/api/admin/finance-summary`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load finance summary.'); setSummary(body) }).catch((error) => setMessage(error.message)) }, []); return <><AdminIntro eyebrow="FINANCE" title="Money movement with history." action={<button className="admin-date">All recorded time ▾</button>} />{message && <div className="admin-login-error">{message}</div>}{!summary ? <div className="empty-state">Loading live finance summary...</div> : <><section className="admin-stat-grid"><Stat label="Gross order value" value={formatNaira(Math.round(summary.grossMinor / 100))} note="Paid orders (unpaid, declined and cancelled left out)" /><Stat label="DOORSTEP commission" value={formatNaira(Math.round(summary.commissionMinor / 100))} note="DOORSTEP’s cut on paid orders" /><Stat label="Restaurant payouts" value={formatNaira(Math.round(summary.restaurantPayoutMinor / 100))} note="Businesses’ share of paid orders" /><Stat label="Refunds" value={formatNaira(Math.round(summary.refundMinor / 100))} note={`${summary.successfulPayments} successful payments`} /></section><section className="admin-panel finance-note"><Shield size={21} /><div><h3>Only the owner can move money</h3><p>These totals are read from server-owned records. Refunds, commission edits, and payout approvals remain server-side actions with idempotency and audit records.</p></div></section></>}</> }
function AuditLogs() { const [logs, setLogs] = useState([]); const [message, setMessage] = useState('');  const token = localStorage.getItem('doorstep-admin-token'); useEffect(() => { fetch(`${apiBase}/api/admin/audit-logs`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load audit logs.'); setLogs(body.logs || []) }).catch((error) => setMessage(error.message)) }, []); return <><AdminIntro eyebrow="AUDIT HISTORY" title="Sensitive actions, accounted for." />{message && <div className="admin-login-error">{message}</div>}<section className="admin-table">{logs.length === 0 && !message ? <div className="empty-state">No audit records yet.</div> : logs.map((log) => <div className="admin-table-row" key={log.id}><div className="admin-person"><span>{log.actor?.firstName?.charAt(0) || 'S'}</span><div><strong>{log.action}</strong><small>{log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : 'System'} · {new Date(log.createdAt).toLocaleString('en-NG')}</small></div></div><span className="admin-pill active">{log.entityType}</span><small>{log.entityId}</small></div>)}</section></> }

function Customers() { const [customers, setCustomers] = useState([]); const [message, setMessage] = useState('');  const token = localStorage.getItem('doorstep-admin-token'); const load = () => fetch(`${apiBase}/api/admin/customers`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load customers.'); setCustomers(body.customers || []) }).catch((error) => setMessage(error.message)); useEffect(() => { load() }, []); const changeStatus = async (id, status) => { const response = await fetch(`${apiBase}/api/admin/customers/${id}/status`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); if (response.ok) load(); else { const body = await response.json(); setMessage(body.error || 'Could not update customer.') } }; return <><AdminIntro eyebrow="CUSTOMER MANAGEMENT" title="Customers under your care." />{message && <div className="admin-login-error">{message}</div>}<section className="admin-table">{customers.length === 0 && !message ? <div className="empty-state">No customers found.</div> : customers.map((customer) => <div className="admin-table-row" key={customer.id}><div className="admin-person"><span>{customer.firstName.charAt(0)}</span><div><strong>{customer.firstName} {customer.lastName}</strong><small>{customer.email} · {customer._count.orders} orders · {customer._count.supportTickets} tickets</small></div></div><span className={`admin-pill ${customer.status === 'ACTIVE' ? 'approved' : 'pending'}`}>{customer.status}</span><button className="admin-review" onClick={() => changeStatus(customer.id, customer.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}>{customer.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</button></div>)}</section></> }

function Reviews() { const [reviews, setReviews] = useState([]); const [message, setMessage] = useState('');  const token = localStorage.getItem('doorstep-admin-token'); const load = () => fetch(`${apiBase}/api/admin/reviews?pending=true`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load reviews.'); setReviews(body.reviews || []) }).catch((error) => setMessage(error.message)); useEffect(() => { load() }, []); const moderate = async (id, approved) => { const response = await fetch(`${apiBase}/api/admin/reviews/${id}/moderation`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ approved }) }); if (response.ok) load(); else { const body = await response.json(); setMessage(body.error || 'Could not moderate review.') } }; return <><AdminIntro eyebrow="REVIEW MODERATION" title="Keep public feedback useful." />{message && <div className="admin-login-error">{message}</div>}<section className="admin-table">{reviews.length === 0 && !message ? <div className="empty-state">No pending reviews.</div> : reviews.map((review) => <div className="admin-table-row" key={review.id}><div><strong>{review.restaurant.name}</strong><small>{review.user.firstName} {review.user.lastName} · {review.rating}/5 · {new Date(review.createdAt).toLocaleDateString('en-NG')}</small><p>{review.body || 'No written comment.'}</p></div><button className="admin-review" onClick={() => moderate(review.id, true)}><Check size={14} /> Approve</button><button className="row-more" onClick={() => moderate(review.id, false)}>Reject</button></div>)}</section></> }

function SettingsPage() { const [settings, setSettings] = useState([]); const [message, setMessage] = useState('');  const token = localStorage.getItem('doorstep-admin-token'); const labels = { restaurant_commission_percentage: 'Restaurant commission (%)', service_fee_percentage: 'Customer service fee (%)', maximum_delivery_radius_km: 'Maximum delivery radius (km)', rider_base_earning_minor: 'Rider base earning (minor units)' }; const load = () => fetch(`${apiBase}/api/admin/settings`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load settings.'); setSettings(body.settings || []) }).catch((error) => setMessage(error.message)); useEffect(() => { load() }, []); const save = async (key, value) => { const response = await fetch(`${apiBase}/api/admin/settings`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: Number(value) }) }); if (response.ok) { setMessage('Setting saved and audited.'); load() } else { const body = await response.json(); setMessage(body.error || 'Could not save setting.') } }; return <><AdminIntro eyebrow="PLATFORM SETTINGS" title="Rules the marketplace follows." />{message && <div className="profile-message">{message}</div>}<section className="admin-table">{settings.length === 0 ? <div className="empty-state">Loading settings...</div> : settings.map((setting) => <form className="admin-table-row" key={setting.key} onSubmit={(event) => { event.preventDefault(); save(setting.key, new FormData(event.currentTarget).get('value')) }}><div><strong>{labels[setting.key] || setting.key}</strong><small>Server-owned setting · audited changes</small></div><input name="value" type="number" min="0" step="0.01" defaultValue={typeof setting.value === 'number' ? setting.value : ''} /><button className="admin-review" type="submit"><Check size={14} /> Save</button></form>)}</section></> }
function ActiveDeliveries() {
  const [deliveries, setDeliveries] = useState([])
  const [message, setMessage] = useState('')
  const token = localStorage.getItem('doorstep-admin-token')
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetch(`${apiBase}/api/admin/deliveries/active`, { headers: { Authorization: `Bearer ${token}` } })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not load active deliveries.')
        if (active) {
          setDeliveries(body.deliveries || [])
          setMessage('')
        }
      } catch (error) {
        if (active) setMessage(error.message)
      }
    }
    load()
    const timer = window.setInterval(load, 15000)
    return () => { active = false; window.clearInterval(timer) }
  }, [apiBase, token])
  return <><AdminIntro eyebrow="DELIVERY OPERATIONS" title="Live delivery command view." /><DispatchBoard /><p className="admin-delivery-privacy">This protected view exposes only operational status, rider identity, and the latest authorized location time. Customer details and location history stay private.</p>{message && <div className="admin-login-error">{message}</div>}<section className="admin-table">{deliveries.length === 0 ? <div className="empty-state">No active deliveries are currently available.</div> : deliveries.map((delivery) => <div className="admin-table-row" key={delivery.id}><div><strong>{delivery.orderNumber}</strong><small>{delivery.restaurant} · {delivery.rider}</small></div><div><span className="portal-status accepted">{delivery.status.replaceAll('_', ' ')}</span><small>{delivery.location?.recordedAt ? `Last verified rider location: ${new Date(delivery.location.recordedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for the rider’s first verified location.'}</small>{delivery.kind === 'order' && delivery.status === 'GOING_TO_CUSTOMER' && <ConfirmDeliveredButton deliveryId={delivery.id} />}</div></div>)}</section></>
}

export function AdminPortal({ path, onLogout }) {
  let content = <AdminHome extras={<><AdminAppDownload /><InstallApp who="admin" /><PushPrompt who="admin" admin /></>} />
  if (path === '/admin/deliveries') content = <ActiveDeliveries />
  if (path === '/admin/restaurants') content = <ApplicationManagement kind="Restaurants" type="restaurant" />
  if (path === '/admin/groceries') content = <ApplicationManagement kind="Groceries" type="grocery" />
  if (path === '/admin/riders') content = <ApplicationManagement kind="Riders" type="rider" />
  if (path === '/admin/customers') content = <Customers />
  if (path === '/admin/orders') content = <LiveAdminOrders />
  if (path === '/admin/parcels') content = <AdminParcels />
  if (path === '/admin/reviews') content = <Reviews />
  if (path === '/admin/payments') content = <PaymentSettingsAdmin />
  if (path === '/admin/finance') content = <FinanceAdmin />
  if (path === '/admin/pricing') content = <DeliveryPricingAdmin />
  if (path === '/admin/locations') content = <LocationsAdmin />
  if (path === '/admin/promos') content = <PromosAdmin />
  if (path === '/admin/analytics') content = <Finance />
  if (path === '/admin/audit-logs') content = <AuditLogs />
  if (path === '/admin/settings') content = <SettingsPage />
  if (path === '/admin/support') content = <SupportDesk />
  if (path === '/admin/notifications') content = <WorkspaceInbox title="Notifications" subtitle="Bank transfers, withdrawals, new partners and orders waiting for a rider." tokenKey="doorstep-admin-token" />
  return <AdminShell path={path}>{content}</AdminShell>
}

import { useEffect, useState } from 'react'
import { Bell, Check, ChevronRight, CircleHelp, Copy, Crown, CreditCard, Globe, Heart, KeyRound, LogOut, MapPin, MessageCircle, Moon, ReceiptText, Store, Tag, Trash2, Truck, User } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { ProfileAvatar } from '../ProfileAvatar'
import { signOut } from '../services/authService'
import { EmptyState, Sheet, ShopHeader, SkeletonList, TabBar } from './ShopKit'
import { appearance, authHeaders, naira, navigate, setAppearance, token } from './shopData'

const link = (href) => (event) => { event.preventDefault(); navigate(href) }

function MenuRow({ icon: Icon, label, hint, href, onClick, tone }) {
  const content = <><span className="sp-menu-icon" aria-hidden="true"><Icon size={18} /></span><span className="sp-menu-text"><b>{label}</b>{hint && <small>{hint}</small>}</span><ChevronRight size={17} aria-hidden="true" /></>
  return <li className={tone ? `is-${tone}` : undefined}>{href ? <a href={href} onClick={link(href)}>{content}</a> : <button type="button" onClick={onClick}>{content}</button>}</li>
}

function AppearanceSheet({ onClose }) {
  const [value, setValue] = useState(appearance)
  const pick = (next) => { setValue(next); setAppearance(next) }
  return <Sheet title="Appearance" onClose={onClose}>
    <ul className="sp-choice-list">{[['light', 'Light'], ['dark', 'Dark'], ['system', 'Same as my phone']].map(([key, label]) => <li key={key}><button type="button" className={value === key ? 'is-selected' : ''} onClick={() => pick(key)}>{label}{value === key && <Check size={16} aria-hidden="true" />}</button></li>)}</ul>
    <p className="sp-note">Applies to the shopping screens on this device.</p>
  </Sheet>
}

function LanguageSheet({ onClose }) {
  return <Sheet title="Language" onClose={onClose}>
    <ul className="sp-choice-list"><li><button type="button" className="is-selected" onClick={onClose}>English<Check size={16} aria-hidden="true" /></button></li></ul>
    <p className="sp-note">DOORSTEP is in English for now. Nigerian Pidgin and more local languages are planned.</p>
  </Sheet>
}

function DeleteAccountSheet({ onClose }) {
  const [reason, setReason] = useState('')
  const [state, setState] = useState({ busy: false, done: null, error: '' })
  const send = async () => {
    setState({ busy: true, done: null, error: '' })
    try {
      const response = await fetch(`${apiBase}/api/account/deletion-request`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason: reason.trim() || undefined }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'We couldn’t send your request. Try again or message support.')
      setState({ busy: false, done: body.ticket?.ticketNumber || 'sent', error: '' })
    } catch (error) { setState({ busy: false, done: null, error: error.message }) }
  }
  return <Sheet title="Delete my account and data" onClose={onClose}>
    {state.done ? <div className="sp-done"><Check size={22} aria-hidden="true" /><p>Request received{state.done !== 'sent' ? ` (ticket ${state.done})` : ''}. DOORSTEP support will confirm by email or phone, then delete your account. Records we must keep by law — such as payments — are kept only as long as required.</p><button type="button" className="sp-primary" onClick={onClose}>Done</button></div> : <>
      <p className="sp-note">We’ll delete your profile, saved addresses, cards and favourites. Open orders must finish first. This can’t be undone.</p>
      <label className="sp-field">Anything we could do better? (optional)<textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {state.error && <p className="sp-error" role="alert">{state.error}</p>}
      <div className="sp-sheet-buttons"><button type="button" className="sp-ghost" onClick={onClose}>Keep my account</button><button type="button" className="sp-primary is-danger" disabled={state.busy} onClick={send}>{state.busy ? 'Sending…' : 'Request deletion'}</button></div>
    </>}
  </Sheet>
}

function useMe() {
  const [user, setUser] = useState(null)
  useEffect(() => { if (!token()) return; fetch(`${apiBase}/api/auth/me`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => setUser(body?.user || null)).catch(() => undefined) }, [])
  return user
}

export function ProfileHub() {
  const signedIn = Boolean(token())
  const user = useMe()
  const [sheet, setSheet] = useState(null)
  const name = user ? (user.preferredName || [user.firstName, user.lastName].filter(Boolean).join(' ') || 'DOORSTEP customer') : 'Your profile'
  return <div className="sp-screen sp-profile">
    <ShopHeader title="Profile" search={false} />
    <main className="sp-main">
      {signedIn ? <a className="sp-profile-card" href="/account/profile" onClick={link('/account/profile')}><ProfileAvatar className="sp-avatar" size={48} /><span><b>{name}</b><small>{user?.email || user?.phone || 'Loading…'}</small></span><ChevronRight size={18} aria-hidden="true" /></a>
        : <div className="sp-profile-card is-guest"><span className="sp-avatar is-guest" aria-hidden="true"><User size={24} /></span><span><b>Welcome to DOORSTEP</b><small>Sign in to order, track deliveries and save addresses.</small></span><div className="sp-guest-actions"><button type="button" className="sp-primary" onClick={() => navigate('/login')}>Sign in</button><button type="button" className="sp-ghost" onClick={() => navigate('/register')}>Create account</button></div></div>}

      <div className="sp-plus-card"><Crown size={22} aria-hidden="true" /><div><b>DOORSTEP Plus</b><small>Free deliveries and member prices — coming soon.</small></div></div>

      {signedIn && <ul className="sp-menu">
        <MenuRow icon={ReceiptText} label="Order history" href="/account/orders" />
        <MenuRow icon={User} label="Account" hint="Name, email and phone" href="/account/profile" />
        <MenuRow icon={MapPin} label="Addresses" href="/account/addresses" />
        <MenuRow icon={CreditCard} label="Payments" hint="Saved cards" href="/account/cards" />
        <MenuRow icon={Tag} label="Promo codes" href="/account/promos" />
        <MenuRow icon={Heart} label="Favourites" href="/account/favorites" />
        <MenuRow icon={Bell} label="Notifications" href="/account/notifications" />
        <MenuRow icon={KeyRound} label="Sign-in & security" href="/account/security" />
      </ul>}
      <ul className="sp-menu">
        <MenuRow icon={Globe} label="Language" hint="English" onClick={() => setSheet('language')} />
        <MenuRow icon={Moon} label="Appearance" hint={{ light: 'Light', dark: 'Dark', system: 'Same as phone' }[appearance()]} onClick={() => setSheet('appearance')} />
        <MenuRow icon={CircleHelp} label="FAQ" href="/help/faq" />
        <MenuRow icon={MessageCircle} label="Help & support" href={signedIn ? '/account/support' : '/help'} />
      </ul>
      <ul className="sp-menu">
        <MenuRow icon={Store} label="Sell on DOORSTEP" href="/partner/register" />
        <MenuRow icon={Truck} label="Ride with DOORSTEP" href="/riders" />
      </ul>
      {signedIn && <ul className="sp-menu">
        <MenuRow icon={Trash2} label="Delete my account and data" tone="danger" onClick={() => setSheet('delete')} />
        <MenuRow icon={LogOut} label="Log out" onClick={() => signOut({ apiBase })} />
      </ul>}
      <p className="sp-legal"><a href="/terms" onClick={link('/terms')}>Terms</a> · <a href="/privacy" onClick={link('/privacy')}>Privacy</a> · <a href="/refund-policy" onClick={link('/refund-policy')}>Refunds</a></p>
    </main>
    <TabBar active="profile" />
    {sheet === 'appearance' && <AppearanceSheet onClose={() => setSheet(null)} />}
    {sheet === 'language' && <LanguageSheet onClose={() => setSheet(null)} />}
    {sheet === 'delete' && <DeleteAccountSheet onClose={() => setSheet(null)} />}
  </div>
}

export function PromosPage() {
  const [state, setState] = useState({ status: 'loading', promotions: [], error: '' })
  const [copied, setCopied] = useState('')
  useEffect(() => {
    if (!token()) { setState({ status: 'signed-out', promotions: [], error: '' }); return }
    fetch(`${apiBase}/api/promos/available`, { headers: authHeaders() }).then(async (response) => { if (!response.ok) throw new Error('Offers couldn’t load.'); return response.json() })
      .then((body) => setState({ status: 'ready', promotions: body.promotions || [], error: '' })).catch((error) => setState({ status: 'error', promotions: [], error: error.message }))
  }, [])
  const copy = (code) => navigator.clipboard?.writeText(code).then(() => { setCopied(code); window.setTimeout(() => setCopied(''), 1600) }).catch(() => undefined)
  return <div className="sp-screen sp-promos">
    <ShopHeader title="Promo codes" back="/profile" search={false} />
    <main className="sp-main">
      {state.status === 'loading' && <SkeletonList rows={2} />}
      {state.status === 'signed-out' && <EmptyState icon={Tag} title="Sign in to see your offers" action={<button type="button" className="sp-primary" onClick={() => navigate('/login')}>Sign in</button>} />}
      {state.status === 'error' && <EmptyState icon={Tag} title="Offers unavailable" body={state.error} />}
      {state.status === 'ready' && (state.promotions.length ? <ul className="sp-promo-list">{state.promotions.map((promo) => <li key={promo.id} className={promo.usable ? '' : 'is-used'}>
        <div className="sp-promo-top"><b>{promo.label}</b>{promo.code ? <button type="button" className="sp-code" onClick={() => copy(promo.code)}>{copied === promo.code ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{promo.code}</button> : <span className="sp-code is-auto">Automatic</span>}</div>
        <p>{promo.description || promo.name}</p>
        <small>{[promo.firstOrderOnly && 'First order only', promo.minSubtotalMinor > 0 && `Minimum basket ${naira(promo.minSubtotalMinor)}`, `Ends ${new Date(promo.endsAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}`].filter(Boolean).join(' · ')}</small>
        {!promo.usable && promo.problem && <small className="sp-promo-why">{promo.problem}</small>}
      </li>)}</ul> : <EmptyState icon={Tag} title="No offers right now" body="New promo codes show up here. If someone gave you a code, enter it at checkout." />)}
    </main>
  </div>
}

const FAQ = [
  ['How is the delivery fee worked out?', 'By the road distance from the store to your pin in Sapele. You see the exact fee at checkout before paying. Pickup orders have no delivery fee.'],
  ['Can I collect my order myself?', 'Yes — on stores that offer pickup, choose “Pickup” on the store page or at checkout. You’ll be notified when it’s ready to collect.'],
  ['Can I order for later?', 'Choose “Schedule” at checkout and pick a time at least 45 minutes ahead, up to 7 days, within the store’s opening hours.'],
  ['Who gets my rider tip?', 'All of it goes to the rider who delivers your order.'],
  ['How do promo codes work?', 'Enter the code at checkout. Automatic offers, like free delivery on your first order, are applied for you. DOORSTEP pays for promotions — the store still gets its full price.'],
  ['Which payment methods can I use?', 'Card, bank and USSD through Paystack, or a bank transfer to DOORSTEP with your receipt uploaded. DOORSTEP never sees your card number.'],
  ['My order is late or wrong. What do I do?', 'Open the order from Orders and tap Help, or message DOORSTEP support from Profile. We’ll sort it out with the store or rider.'],
  ['Do you deliver outside Sapele?', 'Not yet. If your address is outside the delivery area you’ll see “Out of delivery area” — you can still pick up from a store.'],
]
export function FaqPage() {
  const [open, setOpen] = useState(0)
  return <div className="sp-screen sp-faq">
    <ShopHeader title="FAQ" back="/profile" search={false} />
    <main className="sp-main"><ul className="sp-faq-list">{FAQ.map(([question, answer], index) => <li key={question}><button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? -1 : index)}><b>{question}</b><ChevronRight size={16} aria-hidden="true" /></button>{open === index && <p>{answer}</p>}</li>)}</ul>
      <button type="button" className="sp-ghost is-wide" onClick={() => navigate(token() ? '/account/support' : '/help')}>Still need help? Message support</button>
    </main>
  </div>
}

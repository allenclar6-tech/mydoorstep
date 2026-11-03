import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, CreditCard, Pencil, Plus, ShieldCheck, Star, Trash2 } from 'lucide-react'
import { api } from '../parcel/api'
import { useSavedCards } from '../account/SavedCards'
import { EmptyState, Sheet } from './ShopKit'
import { navigate, token } from './shopData'
import { toast } from './Toaster'

// Glovo-style "Payment methods" and "Add new card".
// Security: card number, expiry and CVC are typed ONLY on Paystack's secure pop-up (InlineJS v2) or, if the pop-up
// can't load, Paystack's checkout page. DOORSTEP's form only collects the cardholder name and a nickname. The server
// keeps an encrypted Paystack token plus brand, last 4 and expiry (server/cardService.js).

const PAYSTACK_INLINE = 'https://js.paystack.co/v2/inline.js'
const naira = (minor) => `₦${Math.round((minor || 0) / 100).toLocaleString('en-NG')}`
const brandKey = (brand) => { const value = String(brand || '').toLowerCase(); return value.includes('visa') ? 'visa' : value.includes('master') ? 'mastercard' : value.includes('verve') ? 'verve' : value.includes('amex') || value.includes('american') ? 'amex' : 'other' }
const BRAND_NAME = { visa: 'Visa', mastercard: 'Mastercard', verve: 'Verve', amex: 'Amex', other: 'Card' }

/** Loads Paystack's official InlineJS once. Resolves with window.PaystackPop, or rejects so the caller can fall back. */
let inlineLoader = null
function loadPaystackInline() {
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop)
  if (!inlineLoader) {
    inlineLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = PAYSTACK_INLINE
      script.async = true
      const timer = setTimeout(() => reject(new Error('timeout')), 10_000)
      script.onload = () => { clearTimeout(timer); window.PaystackPop ? resolve(window.PaystackPop) : reject(new Error('missing')) }
      script.onerror = () => { clearTimeout(timer); reject(new Error('blocked')) }
      document.head.appendChild(script)
    }).catch((error) => { inlineLoader = null; throw error })
  }
  return inlineLoader
}

/** Plain-English message for every way adding a card can go wrong. */
export function cardProblem(result) {
  if (!result) return 'Couldn’t check the card. Look at Payment methods in a minute — it may already be saved.'
  if (result.status === 'NOT_REUSABLE') return 'Your bank doesn’t allow this card to be saved for later. You can still pay with it at checkout.'
  if (result.status === 'MISMATCH') return 'The card check didn’t match. Nothing was saved. Please try again.'
  const reason = String(result.gatewayResponse || '').toLowerCase()
  if (/insufficient/.test(reason)) return 'The card was declined (not enough money for the ₦100 check). Try another card.'
  if (/invalid|incorrect|wrong/.test(reason)) return 'The card details weren’t accepted. Check the number, expiry and CVC on Paystack and try again.'
  if (/otp|pin|authenti|3d|token/.test(reason)) return 'The bank check (OTP or PIN) wasn’t completed. Try again and finish the step your bank asks for.'
  if (/declin|not permitted|restricted|do not honou?r/.test(reason)) return 'Your bank declined the card. Try another card or call your bank to allow online payments.'
  if (result.status === 'FAILED') return result.gatewayResponse ? `Paystack said: ${result.gatewayResponse}. Nothing was saved.` : 'The card wasn’t authorized. Nothing was saved.'
  return 'The card isn’t confirmed yet. Check Payment methods in a minute.'
}
const startProblem = (error) => error?.code === 'SAVED_CARDS_NOT_CONFIGURED' ? 'Saving cards isn’t switched on yet. You can still pay by card at checkout.'
  : error?.code === 'CARD_ATTEMPTS_LIMIT' ? error.message
    : error?.code === 'NETWORK' ? 'No internet connection. Check your data or Wi-Fi and try again.'
      : error?.code === 'PAYMENT_PROVIDER_UNAVAILABLE' || error?.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED' ? 'Paystack isn’t responding right now. Please try again in a few minutes.'
        : error?.message || 'Couldn’t start adding the card. Please try again.'

/** Asks DOORSTEP's server (which asks Paystack) whether the card was saved. Retries a few times while Paystack finishes. */
async function confirmCard(reference) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await api('/api/payments/verify', { method: 'POST', body: { reference } }).catch(() => null)
    if (result && result.status !== 'PENDING' && result.status !== 'PROCESSING') return result
    await new Promise((resolve) => setTimeout(resolve, 1500 + attempt * 500))
  }
  return { status: 'PENDING' }
}

/** A saved card drawn like a real card (brand colours, masked number, expiry, holder, nickname). */
export function CardFace({ card, compact = false }) {
  const key = brandKey(card.brand)
  return <div className={`cd-face is-${key}${card.expired ? ' is-expired' : ''}${compact ? ' is-compact' : ''}`} aria-label={`${BRAND_NAME[key]} ending ${card.last4}`}>
    <div className="cd-face-top"><span className="cd-nick">{card.nickname || card.bank || BRAND_NAME[key]}</span>{card.isDefault && <span className="cd-default"><Star size={11} aria-hidden="true" />Default</span>}</div>
    <span className="cd-chip" aria-hidden="true" />
    <span className="cd-number" aria-hidden="true">•••• •••• •••• {card.last4}</span>
    <div className="cd-face-bottom">
      <span><small>Card holder</small>{card.holderName || '—'}</span>
      <span><small>Expires</small>{card.expired ? 'Expired' : `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`}</span>
      <b className="cd-brand">{BRAND_NAME[key]}</b>
    </div>
  </div>
}

/** Glovo-style “Add new card”. The card fields are Paystack's — this screen shows the same layout and opens Paystack. */
export function AddCardPage() {
  const cards = useSavedCards()
  const [holderName, setHolderName] = useState('')
  const [nickname, setNickname] = useState('')
  const [step, setStep] = useState('form')
  const [error, setError] = useState('')
  const popupRef = useRef(null)
  useEffect(() => { if (!token()) return; api('/api/auth/me').then(({ user }) => setHolderName((current) => current || `${user.firstName || ''} ${user.lastName || ''}`.trim())).catch(() => undefined) }, [])

  if (!token()) return <div className="sp-screen cd-page"><CardHeader title="Add new card" back="/account/cards" />
    <main className="sp-body"><EmptyState icon={CreditCard} title="Sign in to add a card" body="Saved cards belong to your DOORSTEP account." action={<button type="button" className="sp-primary" onClick={() => navigate('/login?return=/account/cards/new')}>Sign in</button>} /></main></div>

  const finish = async (reference) => {
    setStep('checking')
    const result = await confirmCard(reference)
    if (result.status === 'SUCCEEDED') {
      toast(result.alreadySaved ? 'This card was already saved' : 'Card saved')
      navigate(`/account/cards?added=${result.alreadySaved ? 'again' : '1'}`)
      return
    }
    setStep('form')
    setError(cardProblem(result))
    cards.reload()
  }

  const start = async (event) => {
    event.preventDefault()
    setError('')
    if (holderName.trim().length < 2) { setError('Type the name on the card.'); return }
    setStep('starting')
    let started
    try {
      started = await api('/api/cards/add', { method: 'POST', body: { holderName: holderName.trim(), nickname: nickname.trim() || null } })
    } catch (startError) { setStep('form'); setError(startProblem(startError)); return }
    // Preferred: Paystack's secure pop-up. Fallback: Paystack's secure page (it returns to DOORSTEP afterwards).
    try {
      if (!started.accessCode) throw new Error('no access code')
      const PaystackPop = await loadPaystackInline()
      const popup = new PaystackPop()
      popupRef.current = popup
      setStep('paystack')
      popup.resumeTransaction(started.accessCode, {
        onSuccess: () => finish(started.reference),
        // Closing the pop-up: check once anyway, in case the card went through just before.
        onCancel: () => { confirmCard(started.reference).then((result) => { if (result.status === 'SUCCEEDED') { toast('Card saved'); navigate('/account/cards?added=1') } else { setStep('form'); setError('You closed Paystack before finishing. Nothing was charged or saved.') } }) },
        onError: () => { setStep('form'); setError('Paystack had a problem opening the card form. Please try again.') },
      })
    } catch {
      window.location.assign(started.authorizationUrl)
    }
  }

  const busy = step !== 'form'
  return <div className="sp-screen cd-page">
    <CardHeader title="Add new card" back="/account/cards" />
    <form className="sp-body cd-form" onSubmit={start} noValidate>
      {cards.mode === 'test' && <p className="cd-note is-warn">Paystack is in test mode — only Paystack test cards work and no real money moves.</p>}
      {!cards.loading && !cards.enabled && <p className="cd-note is-warn">Saving cards isn’t switched on yet. You can still pay by card at checkout.</p>}

      <fieldset className="cd-secure" aria-describedby="cd-secure-note">
        <legend className="cd-sr">Card details (typed on Paystack)</legend>
        <div className="cd-field is-paystack"><span>Card number</span><b aria-hidden="true">0000 0000 0000 0000</b><ShieldCheck size={16} aria-hidden="true" /></div>
        <div className="cd-row">
          <div className="cd-field is-paystack"><span>Expiry date</span><b aria-hidden="true">MM/YY</b></div>
          <div className="cd-field is-paystack"><span>CVC</span><b aria-hidden="true">123</b></div>
        </div>
        <p className="cd-secure-note" id="cd-secure-note"><ShieldCheck size={15} aria-hidden="true" />You’ll type your card number, expiry and CVC on Paystack’s secure screen. DOORSTEP never sees them.</p>
      </fieldset>

      <label className="cd-field"><span>Name of the card holder</span><input value={holderName} maxLength={60} autoComplete="cc-name" onChange={(event) => setHolderName(event.target.value)} placeholder="As written on the card" /></label>
      <label className="cd-field"><span>Card nickname <em>(optional)</em></span><input value={nickname} maxLength={30} onChange={(event) => setNickname(event.target.value)} placeholder="e.g. work card" /></label>

      <p className="cd-check">To confirm the card is yours, Paystack charges <b>{naira(cards.verificationAmountMinor)}</b> and DOORSTEP refunds it straight away. Refunds can take a few working days to show.</p>
      {error && <p className="cd-error" role="alert">{error}</p>}

      <div className="cd-actions"><button type="submit" className="sp-primary cd-done" disabled={busy || (!cards.loading && !cards.enabled)}>
        {step === 'starting' ? 'Opening Paystack…' : step === 'paystack' ? 'Finish on Paystack…' : step === 'checking' ? 'Checking your card…' : 'Done'}
      </button></div>
    </form>
  </div>
}

function CardHeader({ title, back }) {
  return <header className="cd-header">
    <button type="button" className="cd-back" onClick={() => (window.history.length > 1 ? window.history.back() : navigate(back))} aria-label="Back"><ArrowLeft size={20} /></button>
    <h1>{title}</h1>
    <span aria-hidden="true" />
  </header>
}

/** Saved cards, drawn as cards, with Set as default / Rename / Remove. */
export function PaymentMethodsPage() {
  const { loading, enabled, cards, mode, error, reload } = useSavedCards()
  const [menu, setMenu] = useState(null)
  const [rename, setRename] = useState(null)
  const [remove, setRemove] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const added = new URLSearchParams(window.location.search).get('added')

  if (!token()) return <div className="sp-screen cd-page"><CardHeader title="Payment methods" back="/profile" />
    <main className="sp-body"><EmptyState icon={CreditCard} title="Sign in to see your cards" body="Your saved cards belong to your DOORSTEP account." action={<button type="button" className="sp-primary" onClick={() => navigate('/login?return=/account/cards')}>Sign in</button>} /></main></div>

  const run = async (work, done) => {
    setBusy(true); setProblem('')
    try { await work(); toast(done); reload() } catch (actionError) { setProblem(actionError.message || 'That didn’t work. Try again.') } finally { setBusy(false); setMenu(null); setRename(null); setRemove(null) }
  }
  const makeDefault = (card) => run(() => api(`/api/cards/${card.id}`, { method: 'PATCH', body: { isDefault: true } }), `${card.nickname || `•••• ${card.last4}`} is now your default card`)
  const saveName = (card, value) => run(() => api(`/api/cards/${card.id}`, { method: 'PATCH', body: { nickname: value.trim() || null } }), 'Nickname saved')
  const removeCard = (card) => run(() => api(`/api/cards/${card.id}`, { method: 'DELETE' }), 'Card removed')

  return <div className="sp-screen cd-page">
    <CardHeader title="Payment methods" back="/profile" />
    <main className="sp-body cd-list-page">
      {mode === 'test' && <p className="cd-note is-warn">Paystack is in test mode — no real money moves.</p>}
      {added && <p className="cd-note is-ok"><Check size={16} aria-hidden="true" />{added === 'again' ? 'That card was already saved — it’s below.' : 'Card saved. The ₦100 check is being refunded.'}</p>}
      {(error || problem) && <p className="cd-error" role="alert">{problem || error}</p>}
      {loading && <div className="sp-skeletons"><div className="sp-skeleton cd-skeleton" /></div>}
      {!loading && !enabled && <p className="cd-note is-warn">Saving cards isn’t switched on yet. You can still pay by card at checkout.</p>}
      {!loading && enabled && cards.length === 0 && <EmptyState icon={CreditCard} title="No saved cards yet" body="Add a card for one-tap checkout, or tick “Save my card” the next time you pay." />}
      {cards.length > 0 && <ul className="cd-list">{cards.map((card) => <li key={card.id}>
        <CardFace card={card} />
        <div className="cd-card-actions">
          {!card.isDefault && !card.expired ? <button type="button" className="sp-ghost" disabled={busy} onClick={() => makeDefault(card)}><Star size={15} aria-hidden="true" />Set as default</button> : <span className="cd-default-note">{card.expired ? 'This card has expired' : 'Used first at checkout'}</span>}
          <button type="button" className="cd-more" onClick={() => setMenu(card)} aria-label={`Edit card ending ${card.last4}`}><Pencil size={15} aria-hidden="true" />Edit</button>
        </div>
      </li>)}</ul>}
      {enabled && <button type="button" className="cd-add" onClick={() => navigate('/account/cards/new')}><span><Plus size={20} aria-hidden="true" /></span>Add new card</button>}
      <p className="cd-secure-note is-foot"><ShieldCheck size={15} aria-hidden="true" />Card numbers are typed on Paystack and never reach DOORSTEP. We keep only an encrypted Paystack token, the card brand, last 4 digits and expiry.</p>
    </main>

    {menu && <Sheet title={menu.nickname || `Card ending ${menu.last4}`} onClose={() => setMenu(null)}>
      <div className="cd-menu">
        {!menu.isDefault && !menu.expired && <button type="button" disabled={busy} onClick={() => makeDefault(menu)}><Star size={18} aria-hidden="true" />Set as default</button>}
        <button type="button" onClick={() => { setRename({ card: menu, value: menu.nickname || '' }); setMenu(null) }}><Pencil size={18} aria-hidden="true" />{menu.nickname ? 'Rename card' : 'Add a nickname'}</button>
        <button type="button" className="is-danger" onClick={() => { setRemove(menu); setMenu(null) }}><Trash2 size={18} aria-hidden="true" />Remove card</button>
      </div>
    </Sheet>}
    {rename && <Sheet title="Card nickname" onClose={() => setRename(null)}>
      <form onSubmit={(event) => { event.preventDefault(); saveName(rename.card, rename.value) }} className="cd-rename">
        <label className="cd-field"><span>Nickname</span><input autoFocus value={rename.value} maxLength={30} onChange={(event) => setRename({ ...rename, value: event.target.value })} placeholder="e.g. work card" /></label>
        <button type="submit" className="sp-primary cd-done" disabled={busy}>Save</button>
      </form>
    </Sheet>}
    {remove && <Sheet title="Remove this card?" onClose={() => setRemove(null)}>
      <CardFace card={remove} compact />
      <p className="sp-note">You can add it again any time.{remove.isDefault ? ' Your next card becomes the default.' : ''}</p>
      <div className="ae-row-actions"><button type="button" className="sp-primary is-danger" disabled={busy} onClick={() => removeCard(remove)}>{busy ? 'Removing…' : 'Remove card'}</button><button type="button" className="sp-ghost" onClick={() => setRemove(null)}>Keep it</button></div>
    </Sheet>}
  </div>
}

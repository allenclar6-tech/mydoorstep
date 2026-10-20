import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CreditCard, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { api, naira, token } from '../parcel/api'

const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const brandName = (brand) => brand ? brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase() : 'Card'

export function cardLabel(card) {
  return `${brandName(card.brand)} •••• ${card.last4}`
}

/** Loads the customer's saved cards. `enabled` is false until the server has saved cards configured. */
export function useSavedCards() {
  const [state, setState] = useState({ loading: true, enabled: false, cards: [], mode: null, verificationAmountMinor: 10000, error: '' })
  const load = useCallback(() => {
    if (!token()) { setState((current) => ({ ...current, loading: false })); return }
    api('/api/cards').then((body) => setState({ loading: false, enabled: body.enabled, cards: body.cards, mode: body.mode, verificationAmountMinor: body.verificationAmountMinor, error: '' }))
      .catch((error) => setState((current) => ({ ...current, loading: false, error: error.message })))
  }, [])
  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}

/**
 * Radio options for paying: each usable saved card, plus "new card" with an optional
 * "save this card" tick box. `value` is 'NEW' or a card id.
 */
export function SavedCardChoices({ cards, value, onChange, saveCard, onSaveCardChange, enabled, name = 'card-choice' }) {
  const usable = cards.filter((card) => !card.expired)
  return <div className="saved-card-choices">
    {usable.map((card) => <label key={card.id} className={value === card.id ? 'is-selected' : ''}>
      <input type="radio" name={name} checked={value === card.id} onChange={() => onChange(card.id)} />
      <CreditCard size={18} aria-hidden="true" />
      <span><strong>{cardLabel(card)}</strong><small>Expires {card.expMonth}/{String(card.expYear).slice(-2)}{card.bank ? ` · ${card.bank}` : ''}</small></span>
    </label>)}
    <label className={value === 'NEW' ? 'is-selected' : ''}>
      <input type="radio" name={name} checked={value === 'NEW'} onChange={() => onChange('NEW')} />
      <Plus size={18} aria-hidden="true" />
      <span><strong>{usable.length ? 'Use a different card or bank' : 'Pay on Paystack'}</strong><small>Card, transfer or USSD on Paystack’s secure page</small></span>
    </label>
    {value === 'NEW' && enabled && <label className="saved-card-save"><input type="checkbox" checked={saveCard} onChange={(event) => onSaveCardChange(event.target.checked)} /> Save my card for faster checkout next time</label>}
  </div>
}

export function PaymentMethodsPage() {
  const { loading, enabled, cards, mode, verificationAmountMinor, error, reload } = useSavedCards()
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [confirmRemove, setConfirmRemove] = useState('')
  if (!token()) return <main className="route-page account-app"><p className="parcel-notice is-info">Sign in to manage your payment methods.</p><button type="button" className="primary-button" onClick={() => navigate('/login?return=/account/cards')}>Sign in</button></main>

  const add = async () => {
    setBusy('add'); setMessage('')
    try {
      const body = await api('/api/cards/add', { method: 'POST' })
      window.location.assign(body.authorizationUrl)
    } catch (addError) { setMessage(addError.message); setBusy('') }
  }
  const remove = async (card) => {
    setBusy(card.id); setMessage('')
    try {
      await api(`/api/cards/${card.id}`, { method: 'DELETE' })
      setMessage(`${cardLabel(card)} removed.`)
      setConfirmRemove('')
      reload()
    } catch (removeError) { setMessage(removeError.message) } finally { setBusy('') }
  }

  return <main className="route-page account-app payment-methods-page">
    <header className="account-subhead">
      <button type="button" className="map-icon-button" aria-label="Back to account" onClick={() => navigate('/account')}><ArrowLeft size={18} /></button>
      <h1>Payment methods</h1>
    </header>
    {mode === 'test' && <p className="parcel-notice is-warning">Paystack is in test mode. Only Paystack test cards work and no real money moves.</p>}
    {message && <p className="parcel-notice is-info" role="status">{message}</p>}
    {error && <p className="parcel-notice is-error" role="alert">{error}</p>}
    {loading && <p className="parcel-hint" role="status">Loading your cards…</p>}
    {!loading && !enabled && <p className="parcel-notice is-info">Saving cards is not switched on yet. You can still pay by card on Paystack at checkout.</p>}
    {!loading && enabled && <>
      <section className="saved-card-list" aria-label="Saved cards">
        {cards.length === 0 && <div className="saved-card-empty"><CreditCard size={26} aria-hidden="true" /><p>No saved cards yet. Add one now, or tick “Save my card” the next time you pay.</p></div>}
        {cards.map((card) => <div className={`saved-card${card.expired ? ' is-expired' : ''}`} key={card.id}>
          <span className="saved-card-chip" aria-hidden="true"><CreditCard size={20} /></span>
          <span className="saved-card-main"><strong>{cardLabel(card)}</strong><small>{card.expired ? 'Expired' : `Expires ${card.expMonth}/${String(card.expYear).slice(-2)}`}{card.bank ? ` · ${card.bank}` : ''}</small></span>
          {confirmRemove === card.id
            ? <span className="saved-card-confirm"><button type="button" className="quiet-button danger" disabled={busy === card.id} onClick={() => remove(card)}>{busy === card.id ? 'Removing…' : 'Remove'}</button><button type="button" className="quiet-button" onClick={() => setConfirmRemove('')}>Keep</button></span>
            : <button type="button" className="map-icon-button" aria-label={`Remove ${cardLabel(card)}`} onClick={() => setConfirmRemove(card.id)}><Trash2 size={17} /></button>}
        </div>)}
      </section>
      <div className="saved-card-tip"><strong>Easiest way to save a card</strong><p>Tick “Save my card for faster checkout” when you pay for your next order or package. No extra charge.</p></div>
      <button type="button" className="primary-button saved-card-add" disabled={busy === 'add'} onClick={add}><Plus size={17} /> {busy === 'add' ? 'Opening Paystack…' : 'Add a card now'}</button>
      <p className="parcel-hint">Adding a card now: Paystack charges {naira(verificationAmountMinor)} to confirm the card is yours, and DOORSTEP refunds it straight away (refunds can take a few working days to show). Use a card that’s enabled for online payments.</p>
      <details className="saved-card-help"><summary>Paystack said “Unable to process transaction”?</summary><p>That message comes from Paystack’s fraud protection. It blocks a card for about 24 hours after several tries in a short time, or after several different cards are tried. Wait a day before trying that card again, check with your bank that online/web payments are switched on for the card, or simply save the card during your next order instead.</p></details>
    </>}
    <p className="saved-card-security"><ShieldCheck size={16} aria-hidden="true" />Card numbers are entered on Paystack’s page and never reach DOORSTEP. We keep only an encrypted Paystack token, the last 4 digits and the expiry date.</p>
  </main>
}

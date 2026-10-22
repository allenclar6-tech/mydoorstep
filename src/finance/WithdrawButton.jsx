import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, HandCoins, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { WithdrawCard } from './WithdrawCard'

// A Withdraw button that appears in every partner and rider screen (header) and on their dashboards.
// It opens the same withdrawal sheet as Earnings, so a partner can ask for their money from anywhere.

const readToken = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
const money = (minor) => `₦${Math.round((minor || 0) / 100).toLocaleString('en-NG')}`
const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const CHANGED = 'doorstep-balance-change'

function useWithdrawOptions() {
  const [options, setOptions] = useState(null)
  const load = useCallback(() => {
    if (!readToken() || document.hidden) return
    fetch(`${apiBase}/api/finance/withdrawal-options`, { headers: { Authorization: `Bearer ${readToken()}` } })
      .then((response) => response.ok ? response.json() : null).then((data) => { if (data) setOptions(data) }).catch(() => undefined)
  }, [])
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener(CHANGED, load)
    document.addEventListener('visibilitychange', load)
    return () => { window.clearInterval(timer); window.removeEventListener(CHANGED, load); document.removeEventListener('visibilitychange', load) }
  }, [load])
  return options
}

function WithdrawSheet({ earningsHref, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous }
  }, [onClose])
  return createPortal(<div className="wb-layer" role="dialog" aria-modal="true" aria-label="Withdraw funds">
    <button type="button" className="wb-backdrop" aria-label="Close" onClick={onClose} />
    <section className="wb-sheet">
      <header><strong>Withdraw funds</strong><button type="button" className="wb-close" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <WithdrawCard onAddAccount={() => { onClose(); navigate(earningsHref) }} onChanged={() => window.dispatchEvent(new Event(CHANGED))} />
      <button type="button" className="wb-link" onClick={() => { onClose(); navigate(earningsHref) }}>See full earnings & statement <ArrowUpRight size={14} aria-hidden="true" /></button>
    </section>
  </div>, document.body)
}

/** Compact pill for workspace headers: “₦4,420 · Withdraw”. */
export function WithdrawButton({ earningsHref }) {
  const options = useWithdrawOptions()
  const [open, setOpen] = useState(false)
  const amount = options?.openRequest ? null : options?.availableMinor
  return <>
    <button type="button" className={`wb-pill${options?.openRequest ? ' is-pending' : ''}`} onClick={() => setOpen(true)} aria-label={options?.openRequest ? 'Withdrawal on its way' : `Withdraw funds${amount ? `, ${money(amount)} ready` : ''}`}>
      <HandCoins size={16} aria-hidden="true" />
      <span className="wb-pill-text">{options?.openRequest ? 'On its way' : amount ? <><b>{money(amount)}</b> Withdraw</> : 'Withdraw'}</span>
    </button>
    {open && <WithdrawSheet earningsHref={earningsHref} onClose={() => setOpen(false)} />}
  </>
}

/** Dashboard banner: balance plus a big Withdraw funds button. */
export function WithdrawBanner({ earningsHref, title = 'Your DOORSTEP balance' }) {
  const options = useWithdrawOptions()
  const [open, setOpen] = useState(false)
  if (!options) return null
  const pending = options.openRequest
  return <section className="wb-banner">
    <div className="wb-banner-text">
      <span>{pending ? 'Withdrawal on its way' : title}</span>
      <strong>{money(pending ? pending.amountMinor : options.availableMinor)}</strong>
      <small>{pending ? (pending.status === 'REQUESTED' ? 'Waiting for DOORSTEP to send it' : 'Being sent to your bank') : options.heldMinor > 0 ? `${money(options.heldMinor)} still clearing` : options.account ? `To ${options.account.bankName} ••••${options.account.last4}` : 'Add a bank account to withdraw'}</small>
    </div>
    <button type="button" className="wb-banner-btn" onClick={() => setOpen(true)}><HandCoins size={17} aria-hidden="true" />{pending ? 'Track' : 'Withdraw funds'}</button>
    {open && <WithdrawSheet earningsHref={earningsHref} onClose={() => setOpen(false)} />}
  </section>
}

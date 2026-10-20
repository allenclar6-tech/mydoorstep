import { formatNaira } from '../data'
import { deliveryExplanation } from './useDeliveryQuote'

/** Subtotal / delivery / service / total rows for the cart and checkout summaries. */
export function PriceRows({ totals, state, pending = 'Set at checkout' }) {
  const waiting = state.status === 'loading' ? 'Calculating…' : state.status === 'signed-out' ? 'Sign in to see' : state.status === 'error' ? 'Check address' : pending
  const note = totals.exact ? deliveryExplanation(totals.details) : state.status === 'error' ? state.error : state.status === 'idle' ? 'Delivery is priced by road distance from the store to your map pin.' : ''
  return <>
    <div><span>Subtotal</span><strong>{formatNaira(totals.subtotal)}</strong></div>
    <div><span>Delivery{totals.details?.km != null && <small className="price-km"> · {totals.details.km} km</small>}</span><strong>{totals.exact ? formatNaira(totals.delivery) : <em className="price-pending">{waiting}</em>}</strong></div>
    <div><span>Service fee</span><strong>{totals.exact ? formatNaira(totals.service) : <em className="price-pending">—</em>}</strong></div>
    {note && <p className={state.status === 'error' ? 'price-note is-error' : 'price-note'} role={state.status === 'error' ? 'alert' : undefined}>{note}</p>}
    <div className="total"><span>Total</span><strong>{totals.exact ? formatNaira(totals.total) : `${formatNaira(totals.subtotal)} + fees`}</strong></div>
  </>
}

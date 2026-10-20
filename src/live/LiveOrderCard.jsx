import { Bike, ChefHat, KeyRound, Phone, Search, Store } from 'lucide-react'

const STAGE_TEXT = {
  WAITING_FOR_STORE: 'Waiting for the store to accept',
  PREPARING: 'The store is preparing your order',
  RIDER_TO_STORE: 'Your rider is heading to the store',
  ON_THE_WAY: 'Your order is on its way',
}
const time = (iso) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })

/** Customer's live order view: arrival estimate, rider search state, rider contact and the delivery code. */
export function LiveOrderCard({ order }) {
  const live = order?.live
  if (!live) return null
  const eta = live.eta
  const rider = order.delivery?.rider
  const deliveryStatus = order.delivery?.status
  const Icon = eta?.stage === 'ON_THE_WAY' || eta?.stage === 'RIDER_TO_STORE' ? Bike : eta?.stage === 'PREPARING' ? ChefHat : Store
  if (!eta && !live.deliveryCode) return null
  return <section className="lo-card" aria-live="polite">
    <div className="lo-eta">
      <span className="lo-icon"><Icon size={22} aria-hidden="true" /></span>
      <div>
        {eta?.minutes ? <><strong>{eta.minutes} min</strong><small>Arriving around {time(eta.arriveBy)}{eta.live ? '' : ' · estimate'}</small></> : <strong className="lo-wait">{STAGE_TEXT[eta?.stage] || 'Order in progress'}</strong>}
        {eta?.minutes && <p>{STAGE_TEXT[eta.stage]}</p>}
      </div>
    </div>
    {live.findingRider && <p className="lo-search"><Search size={15} aria-hidden="true" />Finding the nearest rider for you…</p>}
    {rider && <div className="lo-rider"><Bike size={17} aria-hidden="true" /><span><b>{rider.name}</b><small>{deliveryStatus === 'ARRIVED_AT_RESTAURANT' ? 'is collecting your order' : deliveryStatus === 'GOING_TO_CUSTOMER' || deliveryStatus === 'PICKED_UP' ? 'is bringing your order' : 'is your rider'}</small></span>{rider.callAllowed && rider.phone && <a className="lo-call" href={`tel:${rider.phone}`}><Phone size={15} aria-hidden="true" />Call</a>}</div>}
    {live.deliveryCode && <div className="lo-code">
      <KeyRound size={18} aria-hidden="true" />
      <div><small>Delivery code — give it to your rider when you get your order</small><strong aria-label={`Delivery code ${live.deliveryCode.split('').join(' ')}`}>{live.deliveryCode}</strong></div>
    </div>}
  </section>
}

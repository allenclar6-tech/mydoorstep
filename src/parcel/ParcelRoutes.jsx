import { parcelRouteFor, PaymentResultPage } from './ParcelPages'

// Lazy-loaded entry so the map-heavy package screens don't slow the storefront.
export default function ParcelRoutes({ path }) { return parcelRouteFor(path) }
export const PaymentResult = PaymentResultPage

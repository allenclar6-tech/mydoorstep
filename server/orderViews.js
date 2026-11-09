// What each side may see of an order's money planning.
/**
 * Business-facing order: the business sees its own sale, commission and share, but never the rider's pay, DOORSTEP's
 * rider fee or delivery margin — rider pay is between DOORSTEP and its riders.
 */
export function businessOrderView(order) {
  if (!order) return order
  const { deliveryQuote, plannedRiderPayMinor, agreedRiderId, ...rest } = order
  return { ...rest, deliveryDetails: deliveryQuote ? { km: deliveryQuote.km ?? null, area: deliveryQuote.dropoffZone?.name || null } : null }
}

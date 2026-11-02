// The business's "Today" screen: live order counts, today's sales, the last 7 days and best sellers.
// Plus the Glovo-style pause ("stop taking orders for 30 minutes"), which ends by itself.

export const PAUSE_CHOICES = [15, 30, 60, 120]
const COUNTED = ['PAID', 'RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']
export const LIVE_STAGES = {
  new: ['PAID'],
  preparing: ['RESTAURANT_ACCEPTED', 'PREPARING'],
  ready: ['READY_FOR_PICKUP', 'RIDER_ASSIGNED'],
  onTheWay: ['PICKED_UP', 'OUT_FOR_DELIVERY'],
}

/** Paused right now? A pause with an end time stops counting once that time has passed. */
export function pausedNow(restaurant, now = new Date()) {
  if (!restaurant?.temporarilyClosed) return false
  if (!restaurant.pausedUntil) return true
  return new Date(restaurant.pausedUntil) > now
}

/** Local calendar day (YYYY-MM-DD) in Sapele's time zone. */
export const localDay = (date, timeZone = 'Africa/Lagos') => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date))
const weekdayShort = (day, timeZone = 'Africa/Lagos') => new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(new Date(`${day}T12:00:00Z`))

/**
 * orders: [{ status, subtotalMinor, createdAt, items: [{ nameSnapshot, quantity }] }] from the last 7+ days.
 * Sales are the food/goods value (subtotal) of orders that were paid and not cancelled or refunded.
 */
export function todayStats(orders, now = new Date(), timeZone = 'Africa/Lagos') {
  const today = localDay(now, timeZone)
  const days = Array.from({ length: 7 }, (_, index) => localDay(new Date(now.getTime() - (6 - index) * 86_400_000), timeZone))
  const week = days.map((day) => ({ day, label: day === today ? 'Today' : weekdayShort(day, timeZone), salesMinor: 0, orders: 0 }))
  const byDay = new Map(week.map((entry) => [entry.day, entry]))
  const live = Object.fromEntries(Object.keys(LIVE_STAGES).map((key) => [key, 0]))
  const items = new Map()
  for (const order of orders) {
    for (const [key, statuses] of Object.entries(LIVE_STAGES)) if (statuses.includes(order.status)) live[key] += 1
    if (!COUNTED.includes(order.status)) continue
    const entry = byDay.get(localDay(order.createdAt, timeZone))
    if (!entry) continue
    entry.salesMinor += order.subtotalMinor || 0
    entry.orders += 1
    for (const item of order.items || []) items.set(item.nameSnapshot, (items.get(item.nameSnapshot) || 0) + (item.quantity || 0))
  }
  const todayEntry = byDay.get(today)
  const best = [...items.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name, count]) => ({ name, count }))
  const weekSales = week.reduce((sum, entry) => sum + entry.salesMinor, 0)
  const weekOrders = week.reduce((sum, entry) => sum + entry.orders, 0)
  return {
    live,
    today: { orders: todayEntry.orders, salesMinor: todayEntry.salesMinor, averageMinor: todayEntry.orders ? Math.round(todayEntry.salesMinor / todayEntry.orders) : 0 },
    week,
    weekTotals: { salesMinor: weekSales, orders: weekOrders },
    best,
  }
}

/** Seven days ending today: entries [{ at, amountMinor?, count? }] → [{ day, label, amountMinor, count }]. */
export function dailySeries(entries, now = new Date(), timeZone = 'Africa/Lagos') {
  const today = localDay(now, timeZone)
  const week = Array.from({ length: 7 }, (_, index) => { const day = localDay(new Date(now.getTime() - (6 - index) * 86_400_000), timeZone); return { day, label: day === today ? 'Today' : weekdayShort(day, timeZone), amountMinor: 0, count: 0 } })
  const byDay = new Map(week.map((entry) => [entry.day, entry]))
  for (const entry of entries) {
    if (!entry.at) continue
    const target = byDay.get(localDay(entry.at, timeZone))
    if (!target) continue
    target.amountMinor += entry.amountMinor || 0
    target.count += entry.count ?? 0
  }
  return week
}

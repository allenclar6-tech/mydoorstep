// First-line answers in the help chat. Every fact comes from DOORSTEP's database or from how the product
// actually works; nothing is invented (no sample restaurants, prices or delivery times). When it can't help,
// it says a person from the team will reply in the same chat.

const naira = (minor) => `₦${Math.round(minor / 100).toLocaleString('en-NG')}`
const has = (text, words) => words.some((word) => text.includes(word))
const STOP = new Set(['i', 'want', 'to', 'buy', 'order', 'get', 'some', 'please', 'the', 'a', 'an', 'do', 'you', 'have', 'any', 'where', 'can', 'find', 'me', 'for', 'is', 'there', 'food', 'near', 'in', 'sapele', 'what', 'and', 'with'])

async function approvedStores(db, storeType) {
  return db.restaurant.findMany({ where: { status: 'APPROVED', temporarilyClosed: false, ...(storeType ? { storeType } : {}) }, select: { name: true, cuisineCategory: true, slug: true, storeType: true }, orderBy: { ratingCount: 'desc' }, take: 6 })
}

async function findItems(db, text) {
  const words = text.split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP.has(word)).slice(0, 4)
  if (!words.length) return []
  return db.menuItem.findMany({
    where: { available: true, restaurant: { status: 'APPROVED', temporarilyClosed: false }, OR: words.map((word) => ({ name: { contains: word, mode: 'insensitive' } })) },
    select: { name: true, priceMinor: true, restaurant: { select: { name: true } } },
    take: 5,
  })
}

/** Returns a short, honest reply. `db` is a Prisma client; lookups fail soft to a generic answer. */
export async function supportReply(db, message, { signedIn = true, category = '' } = {}) {
  const text = String(message || '').toLowerCase()
  const handoff = signedIn ? 'A member of the DOORSTEP team will also see this chat and reply here.' : 'Sign in and send your message here if you would like a member of our team to follow up.'
  try {
    if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(text.trim())) {
      return `Hi! I’m the DOORSTEP assistant. Ask me about an order, a payment, delivery or your account. ${handoff}`
    }
    if (has(text, ['grocery', 'groceries', 'supermarket', 'market', 'provision'])) {
      const stores = await approvedStores(db, 'GROCERY')
      return stores.length
        ? `Grocery stores open on DOORSTEP right now: ${stores.map((store) => store.name).join(', ')}. Open Stores → Groceries to browse what they have in stock.`
        : 'No grocery stores are open on DOORSTEP right now. Please check again later.'
    }
    const items = await findItems(db, text)
    if (items.length) {
      return `I found: ${items.map((item) => `${item.name} at ${item.restaurant.name} (${naira(item.priceMinor)})`).join('; ')}. Search for it on the home screen to order. Prices are set by each restaurant.`
    }
    if (has(text, ['restaurant', 'kitchen', 'eat', 'hungry', 'menu', 'food'])) {
      const stores = await approvedStores(db, 'RESTAURANT')
      return stores.length
        ? `Kitchens open on DOORSTEP right now: ${stores.map((store) => store.cuisineCategory ? `${store.name} (${store.cuisineCategory})` : store.name).join(', ')}. Open one to see its live menu and prices.`
        : 'No restaurants are taking orders right now. Please check again a little later.'
    }
    if (has(text, ['where is my order', 'track', 'late', 'delay', 'rider', 'not arrived', 'still waiting'])) {
      return `You can follow your order live from Orders → the order. It shows each step and the rider on the map once one is assigned. If it looks stuck, tell me the order number. ${handoff}`
    }
    if (has(text, ['refund', 'charged', 'debited', 'deducted', 'double', 'payment', 'paystack', 'card'])) {
      return `Card payments are handled by Paystack, and DOORSTEP only marks an order paid after Paystack confirms it. If you were debited but the order isn’t paid, don’t pay again. Send the order number and the time of the debit here. ${handoff}`
    }
    if (has(text, ['wrong', 'missing', 'spilled', 'cold', 'damaged', 'bad'])) {
      return `Sorry about that. Please send the order number and, if you can, a photo using the camera button. ${handoff}`
    }
    if (has(text, ['package', 'parcel', 'send'])) {
      return 'To send a package, tap Send on the bottom bar, set the pickup and drop-off points, and you’ll see the road distance and price before booking.'
    }
    if (has(text, ['password', 'login', 'log in', 'sign in', 'account', 'verify', 'code', 'otp'])) {
      return `For sign-in problems use “Forgot password?” on the sign-in page; we email you a 6-digit code. Codes expire after 10 minutes, and you can request a new one after a minute. ${handoff}`
    }
    if (has(text, ['deliver to', 'delivery area', 'cover', 'location', 'address'])) {
      return 'DOORSTEP delivers in Sapele. Set your exact address with the map or GPS when you check out. The delivery fee is shown before you pay.'
    }
    if (category === 'PAYMENT') return `Tell me the order number and what happened with the payment. ${handoff}`
    return `Thanks for your message. ${handoff}`
  } catch {
    return `Thanks for your message. ${handoff}`
  }
}

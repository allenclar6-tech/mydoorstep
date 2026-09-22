const restaurants = [
  { name: 'The Palm Kitchen', cuisine: 'Nigerian and local favourites', rating: '4.8', time: '25-35 minutes', fee: 'N800', items: ['Smoky party jollof (N3,500)', 'Peppered chicken (N4,200)', 'Plantain & egg sauce (N2,800)'] },
  { name: 'Nana’s Pot', cuisine: 'soups, swallow, and comfort food', rating: '4.7', time: '30-40 minutes', fee: 'N700', items: ['Banga soup & starch (N4,500)', 'Pounded yam & egusi (N4,000)'] },
  { name: 'Firewood Grill', cuisine: 'grills, suya, and small chops', rating: '4.9', time: '20-30 minutes', fee: 'N600', items: ['Beef suya box (N5,000)', 'Charcoal chicken wings (N4,800)'] },
]

const locations = ['Amukpe', 'Central Sapele', 'New Road', 'Ogodo', 'Sapele Township', 'Market Road', 'Mission Road', 'Warri-Sapele Road', 'Benin-Sapele Road', 'Urban Area', 'Okpe Road', 'Oton Road', 'Oghara Junction', 'Estate Area', 'Hospital Road', 'School Road', 'Water Side', 'Mosogar Road', 'Jesse Road']

const siteBrain = `DOORSTEP is a website-first food delivery marketplace serving Sapele, Delta State, Nigeria. Customers browse approved local restaurants, choose food, add items from one restaurant per order, enter a delivery address, and pay securely through Paystack when payment configuration is available. The default delivery location is Amukpe, Sapele.

Restaurants currently shown:
${restaurants.map((restaurant) => `- ${restaurant.name}: ${restaurant.cuisine}; rating ${restaurant.rating}; delivery ${restaurant.time}; fee ${restaurant.fee}; menu: ${restaurant.items.join(', ')}.`).join('\n')}

Delivery coverage includes ${locations.join(', ')}. Customers can choose an area, use device location, or save an exact address with a landmark. Delivery fee is normally calculated server-side; the current checkout foundation uses N800 as its default quote and a 3% service fee. Delivery estimates are restaurant-specific and can change with operations conditions.

Order flow: browse restaurants or search dishes, add food to the cart, keep one restaurant per order, review subtotal plus delivery and service fee, enter address and phone, create the server order, then initialize Paystack. Customers can view account orders and tracking stages such as payment confirmed, restaurant accepted, preparing, ready for pickup, rider assigned, picked up, out for delivery, and delivered.

Account help: login and registration are database-backed; signup uses a six-digit verification challenge; forgot password uses a short-lived reset code; Account > Profile edits name and phone; Addresses saves delivery places; Favorites stores saved restaurants or dishes; Notifications shows order, payment, delivery, promotion, account, and security updates.

Support: payment, missing order, wrong food, late delivery, restaurant, rider, account, refund, and technical issues can become support tickets. Customers should provide the order number, restaurant, page, or payment reference when relevant. Photos can help document wrong food or delivery issues. Sensitive information such as passwords, verification codes, card numbers, and payment secrets must never be shared in chat. A human DOORSTEP agent can continue a saved conversation.`

function includesAny(text, words) { return words.some((word) => text.includes(word)) }

export function buildAiReply(message, category = '') {
  const text = String(message || '').trim()
  const normalized = text.toLowerCase()
  if (includesAny(normalized, ['hello', 'hi', 'hey', 'good morning', 'good afternoon'])) return 'Welcome to DOORSTEP. I’m the DOORSTEP ONLINE AGENT, here to assist with restaurants, menus, delivery, payments, orders, and account support. How may I help you today?'
  if (includesAny(normalized, ['restaurant', 'kitchen', 'where can i eat', 'food'])) return `The available kitchens are ${restaurants.map((restaurant) => `${restaurant.name} (${restaurant.time}, ${restaurant.fee})`).join('; ')}. I can also help you choose by dish, cuisine, delivery time, or budget.`
  if (includesAny(normalized, ['jollof', 'rice', 'plantain', 'egg'])) return 'The Palm Kitchen offers Smoky party jollof for N3,500 and Plantain & egg sauce for N2,800. The estimated delivery time is 25-35 minutes, with an N800 delivery fee. I can help you open the menu or continue with your order.'
  if (includesAny(normalized, ['banga', 'egusi', 'swallow', 'pounded yam', 'starch'])) return 'Nana’s Pot offers Banga soup & starch for N4,500 and Pounded yam & egusi for N4,000. The estimated delivery time is 30-40 minutes, with an N700 delivery fee.'
  if (includesAny(normalized, ['suya', 'grill', 'wing', 'small chop'])) return 'Firewood Grill offers a Beef suya box for N5,000 and Charcoal chicken wings for N4,800. The estimated delivery time is 20-30 minutes, with an N600 delivery fee.'
  if (includesAny(normalized, ['delivery area', 'deliver to', 'location', 'address', 'sapele'])) return `DOORSTEP currently covers Sapele areas including ${locations.slice(0, 12).join(', ')}, and more listed areas such as Oton Road, Estate Area, Hospital Road, Water Side, Mosogar Road, and Jesse Road. Choose a location from the delivery selector or save an exact address with a landmark.`
  if (includesAny(normalized, ['track', 'where is my order', 'order status', 'late', 'rider'])) return 'To review an order, open Account > Orders and select the relevant order. The timeline may include payment confirmation, restaurant preparation, rider assignment, pickup, and delivery. If the order is delayed, please provide the order number so I can prepare it for support follow-up.'
  if (includesAny(normalized, ['pay', 'payment', 'paystack', 'refund', 'card'])) return 'DOORSTEP processes online payments through Paystack. If a payment is pending or unsuccessful, please keep the order number or payment reference available and use Support > Payment problem for a review. For your protection, do not share card details, passwords, or verification codes here.'
  if (includesAny(normalized, ['login', 'sign in', 'password', 'verification', 'profile', 'account'])) return 'For account access, select Log in. New customers complete a six-digit verification step, while forgotten passwords can be reset through Forgot password. Account > Profile lets you update your name and phone number. Please keep passwords and verification codes private.'
  if (includesAny(normalized, ['wrong food', 'missing', 'photo', 'problem', 'help', 'support', 'agent'])) return 'I can assist with ordering, delivery, restaurants, payments, and account access. For an incorrect or missing item, please share the order number, restaurant name, and a clear photo where helpful. I can also route the conversation to a DOORSTEP support agent.'
  if (category === 'PAYMENT') return 'I can assist with Paystack payment initialization, pending payments, unsuccessful attempts, and refund reviews. Please keep the order number or payment reference available, but never share card details or passwords.'
  return `I can assist with DOORSTEP restaurants, menus, Sapele delivery areas, ordering, tracking, Paystack payments, accounts, and support. ${siteBrain.split('\n')[0]} Please tell me what you need, or include an order number if your question concerns an existing delivery.`
}

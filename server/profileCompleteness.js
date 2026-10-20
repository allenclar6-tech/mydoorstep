// Profile completeness: a checklist computed from real account data (nothing self-reported), with a
// link to the screen that completes each item. Weights add up to 100 for every role.

const item = (key, label, done, weight, href, hint) => ({ key, label, done: Boolean(done), weight, href, hint })

export function customerChecklist({ user, addressCount }) {
  return [
    item('name', 'Add your name', user.firstName && user.lastName, 15, '/account/profile', 'So riders know who to hand your order to.'),
    item('email', 'Verify your email', user.emailVerifiedAt, 20, '/account/security', 'Receipts and account recovery go here.'),
    item('phone', 'Verify your phone number', user.phone && user.phoneVerifiedAt, 20, '/account/security', 'Riders call this number if they cannot find you, and you can sign in with a code.'),
    item('address', 'Save a delivery address', addressCount > 0, 20, '/account/addresses', 'Checkout is faster with a saved address.'),
    item('photo', 'Add a profile photo', user.profileImageKey, 10, '/account/profile', 'Helps riders recognise you at handover.'),
    item('notes', 'Add delivery notes', user.deliveryNotes, 15, '/account/profile', 'Gate codes, landmarks or where to wait.'),
  ]
}

export function riderChecklist({ user, rider }) {
  const application = rider?.application
  const documents = (application?.identityDocuments?.length || 0) + (rider?.documents?.length || 0)
  return [
    item('name', 'Add your name', user.firstName && user.lastName, 10, '/rider/account', 'Customers see your first name.'),
    item('photo', 'Add a profile photo', user.profileImageKey, 15, '/rider/account', 'Customers and partners check it at handover.'),
    item('phone', 'Verify your phone number', user.phone && user.phoneVerifiedAt, 15, '/rider/security', 'Customers and partners need to reach you.'),
    item('vehicle', 'Add your vehicle details', rider?.vehicleType && (rider.vehicleType === 'bicycle' || rider.vehicleDetails), 15, '/rider/account', 'Type and registration for motorised vehicles.'),
    item('documents', 'Upload your ID documents', documents > 0, 20, '/rider/application-status', 'Needed before DOORSTEP can approve you.'),
    item('approved', 'Get approved by DOORSTEP', rider?.status === 'APPROVED', 25, '/rider/application-status', 'You can go online once approved.'),
  ]
}

export function partnerChecklist({ user, restaurant, menuItemCount }) {
  const application = restaurant?.application
  const grocery = restaurant?.storeType === 'GROCERY'
  const businessDone = application?.businessVerificationStatus === 'VERIFIED' || application?.businessVerificationStatus === 'NON_REGISTERED' || application?.registrationType === 'NOT_REGISTERED'
  return [
    item('image', 'Add a cover photo', restaurant?.coverImageUrl, 15, '/restaurant/profile', 'Stores with photos get more orders.'),
    item('description', 'Describe your business', restaurant?.description, 10, '/restaurant/profile', 'Tell customers what you are known for.'),
    item('hours', 'Set opening hours', restaurant?.openingTime && restaurant?.closingTime, 15, '/restaurant/profile', 'Customers can only order while you are open.'),
    item('menu', grocery ? 'Add at least 5 products' : 'Add at least 5 dishes', menuItemCount >= 5, 25, '/restaurant/menu', `You have ${menuItemCount} so far.`),
    item('phone', 'Verify your phone number', user.phone && user.phoneVerifiedAt, 10, '/restaurant/security', 'Riders and DOORSTEP support call this number.'),
    item('business', 'Confirm your business registration', businessDone, 25, '/partner/application-status', 'Registered businesses upload their CAC certificate; unregistered businesses just confirm it.'),
  ]
}

export function summarise(items) {
  const total = items.reduce((sum, entry) => sum + entry.weight, 0) || 1
  const earned = items.reduce((sum, entry) => sum + (entry.done ? entry.weight : 0), 0)
  const percent = Math.round((earned / total) * 100)
  return { percent, complete: percent === 100, items, next: items.find((entry) => !entry.done) || null }
}

/** Loads what the checklist needs for the signed-in user. Admin accounts have no checklist. */
export async function profileCompleteness(prisma, user) {
  if (user.role === 'CUSTOMER') {
    const addressCount = await prisma.address.count({ where: { userId: user.id } })
    return { role: 'CUSTOMER', ...summarise(customerChecklist({ user, addressCount })) }
  }
  if (user.role === 'RIDER') {
    const rider = await prisma.rider.findUnique({ where: { userId: user.id }, include: { application: { include: { identityDocuments: { select: { id: true } } } }, documents: { select: { id: true } } } })
    return { role: 'RIDER', ...summarise(riderChecklist({ user, rider })) }
  }
  if (user.role === 'RESTAURANT') {
    const membership = await prisma.restaurantUser.findFirst({ where: { userId: user.id }, include: { restaurant: { include: { application: true } } } })
    const restaurant = membership?.restaurant || null
    const menuItemCount = restaurant ? await prisma.menuItem.count({ where: { restaurantId: restaurant.id } }) : 0
    return { role: 'RESTAURANT', ...summarise(partnerChecklist({ user, restaurant, menuItemCount })) }
  }
  return { role: user.role, percent: 100, complete: true, items: [], next: null }
}

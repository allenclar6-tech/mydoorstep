import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const country = await prisma.country.upsert({ where: { code: 'NG' }, update: {}, create: { code: 'NG', name: 'Nigeria' } })
  const state = await prisma.state.upsert({ where: { countryId_name: { countryId: country.id, name: 'Delta State' } }, update: {}, create: { countryId: country.id, name: 'Delta State' } })
  const city = await prisma.city.upsert({ where: { stateId_name: { stateId: state.id, name: 'Sapele' } }, update: {}, create: { stateId: state.id, name: 'Sapele' } })

  await prisma.serviceArea.upsert({ where: { countryId_stateId_cityId: { countryId: country.id, stateId: state.id, cityId: city.id } }, update: { enabled: true, currency: 'NGN', timezone: 'Africa/Lagos' }, create: { countryId: country.id, stateId: state.id, cityId: city.id, enabled: true, currency: 'NGN', timezone: 'Africa/Lagos' } })

  await prisma.deliveryZone.upsert({ where: { cityId_name: { cityId: city.id, name: 'Central Sapele' } }, update: {}, create: { cityId: city.id, name: 'Central Sapele', baseFeeMinor: 80000, perKmFeeMinor: 0, maxRadiusKm: 5 } })
  await prisma.deliveryZone.upsert({ where: { cityId_name: { cityId: city.id, name: 'Extended Sapele' } }, update: {}, create: { cityId: city.id, name: 'Extended Sapele', baseFeeMinor: 120000, perKmFeeMinor: 0, maxRadiusKm: 12 } })

  const settings = [
    ['restaurant_commission_percentage', 15],
    ['service_fee_percentage', 3],
    ['minimum_order_minor', 0],
    ['maximum_delivery_radius_km', 12],
    ['rider_base_earning_minor', 50000],
  ]
  for (const [key, value] of settings) await prisma.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } })

  const restaurantSeeds = [
    { id: 'restaurant-palm', name: 'The Palm Kitchen', slug: 'the-palm-kitchen', category: 'Jollof & rice', items: [{ id: 'palm-1', name: 'Smoky party jollof', priceMinor: 350000 }, { id: 'palm-2', name: 'Peppered chicken', priceMinor: 420000 }, { id: 'palm-3', name: 'Plantain & egg sauce', priceMinor: 280000 }] },
    { id: 'restaurant-nana', name: 'Nana’s Pot', slug: 'nanas-pot', category: 'Swallow', items: [{ id: 'nana-1', name: 'Banga soup & starch', priceMinor: 450000 }, { id: 'nana-2', name: 'Pounded yam & egusi', priceMinor: 400000 }] },
    { id: 'restaurant-firewood', name: 'Firewood Grill', slug: 'firewood-grill', category: 'Grills', items: [{ id: 'fire-1', name: 'Beef suya box', priceMinor: 500000 }, { id: 'fire-2', name: 'Charcoal chicken wings', priceMinor: 480000 }] },
  ]
  for (const seed of restaurantSeeds) {
    const restaurant = await prisma.restaurant.upsert({ where: { id: seed.id }, update: { status: 'APPROVED', name: seed.name, slug: seed.slug, cityId: city.id, openingTime: '09:00', closingTime: '22:00', daysOpen: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'], temporarilyClosed: false }, create: { id: seed.id, name: seed.name, slug: seed.slug, address: 'Sapele, Delta State', cityId: city.id, status: 'APPROVED', openingTime: '09:00', closingTime: '22:00', daysOpen: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] } })
    const category = await prisma.menuCategory.upsert({ where: { restaurantId_name: { restaurantId: restaurant.id, name: seed.category } }, update: {}, create: { restaurantId: restaurant.id, name: seed.category } })
    for (const item of seed.items) await prisma.menuItem.upsert({ where: { id: item.id }, update: { restaurantId: restaurant.id, categoryId: category.id, name: item.name, priceMinor: item.priceMinor, available: true }, create: { id: item.id, restaurantId: restaurant.id, categoryId: category.id, name: item.name, priceMinor: item.priceMinor, available: true } })
  }

  console.log(`Seeded ${country.name}, ${state.name}, ${city.name}, delivery zones, and platform settings.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())

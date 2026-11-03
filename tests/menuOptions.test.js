import test from 'node:test'
import assert from 'node:assert/strict'
import { optionGroupsInputSchema, optionsLine, priceSelections, publicOptionGroups } from '../server/menuOptions.js'

const dish = {
  name: 'Jollof rice',
  optionGroups: [
    { id: 'g2', name: 'Extras', required: false, minSelect: 0, maxSelect: 2, sortOrder: 1, options: [
      { id: 'plantain', name: 'Plantain', priceMinor: 30_000, active: true, sortOrder: 0 },
      { id: 'egg', name: 'Egg', priceMinor: 20_000, active: true, sortOrder: 1 },
      { id: 'moi', name: 'Moi moi', priceMinor: 50_000, active: false, sortOrder: 2 },
    ] },
    { id: 'g1', name: 'Protein', required: true, minSelect: 1, maxSelect: 1, sortOrder: 0, options: [
      { id: 'chicken', name: 'Chicken', priceMinor: 0, active: true, sortOrder: 0 },
      { id: 'beef', name: 'Beef', priceMinor: 50_000, active: true, sortOrder: 1 },
    ] },
  ],
}

test('the customer app gets groups in order, with only options that are in stock', () => {
  const groups = publicOptionGroups(dish)
  assert.deepEqual(groups.map((group) => group.name), ['Protein', 'Extras'])
  assert.deepEqual(groups[1].options.map((option) => option.id), ['plantain', 'egg'])
  assert.equal(groups[0].options[1].price, 500)
  assert.equal(groups[0].min, 1)
})

test('choices are priced from the menu, not from the customer', () => {
  const { extraMinor, snapshot } = priceSelections(dish, ['beef', 'plantain', 'egg'])
  assert.equal(extraMinor, 100_000)
  assert.deepEqual(snapshot.map((entry) => entry.name), ['Beef', 'Plantain', 'Egg'])
  assert.equal(optionsLine(snapshot), 'Beef (+₦500), Plantain (+₦300), Egg (+₦200)')
})

test('a required choice cannot be skipped and limits are enforced', () => {
  assert.throws(() => priceSelections(dish, ['plantain']), (error) => error.status === 409 && /Protein/.test(error.message))
  assert.throws(() => priceSelections(dish, ['chicken', 'beef']), /up to 1/)
  assert.throws(() => priceSelections(dish, ['chicken', 'moi']), /no longer available/)
  assert.throws(() => priceSelections(dish, ['chicken', 'someone-elses-option']), /no longer available/)
})

test('dishes without choices still work, and repeated ids count once', () => {
  assert.deepEqual(priceSelections({ name: 'Water' }, []), { extraMinor: 0, snapshot: [] })
  assert.equal(priceSelections(dish, ['chicken', 'egg', 'egg']).extraMinor, 20_000)
})

test('the partner editor input is checked', () => {
  assert.equal(optionGroupsInputSchema.safeParse({ groups: [{ name: 'Size', required: true, maxSelect: 1, options: [{ name: 'Large', priceMinor: 50_000 }] }] }).success, true)
  assert.equal(optionGroupsInputSchema.safeParse({ groups: [{ name: 'Size', required: true, maxSelect: 3, options: [{ name: 'Large', priceMinor: 0 }] }] }).success, false)
  assert.equal(optionGroupsInputSchema.safeParse({ groups: [{ name: 'Size', required: true, maxSelect: 1, options: [] }] }).success, false)
  assert.equal(optionGroupsInputSchema.safeParse({ groups: [{ name: 'Size', required: true, maxSelect: 1, options: [{ name: 'Large', priceMinor: -1 }] }] }).success, false)
})

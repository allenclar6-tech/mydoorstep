import { z } from 'zod'

// Glovo-style item options. A dish can have choice groups — "Choose your protein" (required, pick exactly 1),
// "Extras" (optional, up to 3) — and each option can add to the price. The server always works out the price
// from the database; the customer only sends which options they picked.

/** Groups and their active options for the customer app (prices in naira, like the rest of the public menu). */
export function publicOptionGroups(item) {
  return [...(item.optionGroups || [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => ({
      id: group.id,
      name: group.name,
      required: group.required,
      min: group.required ? Math.max(1, group.minSelect) : group.minSelect,
      max: Math.max(1, group.maxSelect),
      options: (group.options || []).filter((option) => option.active).sort((a, b) => a.sortOrder - b.sortOrder)
        .map((option) => ({ id: option.id, name: option.name, price: Math.round(option.priceMinor / 100) })),
    }))
    .filter((group) => group.options.length > 0)
}

const fail = (message) => Object.assign(new Error(message), { status: 409, code: 'ITEM_OPTIONS_INVALID' })

/**
 * Checks the options picked for one dish and prices them. Returns { extraMinor, snapshot } where snapshot is
 * what the order keeps: [{ group, name, priceMinor }]. Throws a 409 with a plain message when a choice is missing,
 * there are too many, or an option isn't (or is no longer) on this dish.
 */
export function priceSelections(item, selectedIds = []) {
  const groups = (item.optionGroups || []).map((group) => ({ ...group, options: (group.options || []).filter((option) => option.active) })).filter((group) => group.options.length > 0)
  const picked = [...new Set(selectedIds)]
  const byId = new Map(groups.flatMap((group) => group.options.map((option) => [option.id, { option, group }])))
  for (const id of picked) if (!byId.has(id)) throw fail(`One of the choices for ${item.name} is no longer available. Please choose again.`)
  const snapshot = []
  let extraMinor = 0
  for (const group of [...groups].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const chosen = group.options.filter((option) => picked.includes(option.id)).sort((a, b) => a.sortOrder - b.sortOrder)
    const min = group.required ? Math.max(1, group.minSelect) : group.minSelect
    const max = Math.max(1, group.maxSelect)
    if (chosen.length < min) throw fail(min === 1 ? `Pick an option for “${group.name}” on ${item.name}.` : `Pick at least ${min} for “${group.name}” on ${item.name}.`)
    if (chosen.length > max) throw fail(`You can choose up to ${max} for “${group.name}” on ${item.name}.`)
    for (const option of chosen) { extraMinor += option.priceMinor; snapshot.push({ group: group.name, name: option.name, priceMinor: option.priceMinor }) }
  }
  return { extraMinor, snapshot }
}

/** A short line for receipts, order boards and the basket: "Chicken, Extra plantain (+₦300)". */
export function optionsLine(snapshot) {
  if (!Array.isArray(snapshot) || !snapshot.length) return ''
  return snapshot.map((entry) => entry.priceMinor ? `${entry.name} (+₦${(entry.priceMinor / 100).toLocaleString('en-NG')})` : entry.name).join(', ')
}

/** What a business sends to set a dish's choices (the whole set at once). Prices in kobo. */
export const optionGroupsInputSchema = z.object({
  groups: z.array(z.object({
    name: z.string().trim().min(1, 'Name each group, e.g. “Choose your protein”.').max(60),
    required: z.boolean(),
    maxSelect: z.number().int().min(1).max(20),
    options: z.array(z.object({
      name: z.string().trim().min(1, 'Name each choice.').max(60),
      priceMinor: z.number().int().min(0).max(10_000_000),
      active: z.boolean().default(true),
    })).min(1, 'Add at least one choice to each group.').max(30),
  })).max(10),
}).superRefine((value, context) => {
  value.groups.forEach((group, index) => {
    if (group.maxSelect > group.options.length) context.addIssue({ code: 'custom', path: ['groups', index, 'maxSelect'], message: `“${group.name}” allows ${group.maxSelect} choices but only has ${group.options.length}.` })
  })
})

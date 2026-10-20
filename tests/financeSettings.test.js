import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultFinanceSettings } from '../server/financeService.js'
import { financeSettingsSchema } from '../server/financeSettings.js'

const settings = structuredClone(defaultFinanceSettings)

test('finance settings validation catches mistakes', () => {
  assert.equal(financeSettingsSchema.safeParse(settings).success, true)
  assert.equal(financeSettingsSchema.safeParse({ ...settings, riderPay: { enabled: true, bands: [] } }).success, false, 'cannot switch rider pay on with no rates')
  assert.equal(financeSettingsSchema.safeParse({ ...settings, riderPay: { enabled: false, bands: [{ upToKm: 2, amountMinor: 1 }, { upToKm: 2, amountMinor: 2 }] } }).success, false)
  assert.equal(financeSettingsSchema.safeParse({ ...settings, commission: { doorstepRiderPercent: 90, ownRiderPercent: 10 } }).success, false)
})

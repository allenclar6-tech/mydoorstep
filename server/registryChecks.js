// Registry checks through Ninja (ninja.ng): CAC company lookup for registered businesses and an ID match
// (NIN, driver's licence, passport, voter's card) for riders. Endpoints and fields follow
// https://www.ninja.ng/docs/ . Results only ASSIST an admin; nothing is approved automatically.
// Only a verdict and a minimal summary are stored, never the full registry record.

export class RegistryError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}

const SANDBOX_BASE = 'https://api.sandbox.ninja.boucloud.io'
const LIVE_BASE = 'https://api.ninja.boucloud.io'

export function registryProvider() {
  const key = process.env.NINJA_SECRET_KEY || ''
  if (!key) return null
  return { name: 'ninja', mode: key.startsWith('sk_sandbox_') ? 'sandbox' : 'live', baseUrl: (process.env.NINJA_BASE_URL || (key.startsWith('sk_sandbox_') ? SANDBOX_BASE : LIVE_BASE)).replace(/\/+$/, '') }
}

async function ninja(path, body, fetchImpl) {
  const provider = registryProvider()
  if (!provider) throw new RegistryError('REGISTRY_NOT_CONFIGURED', 'Automatic registry checks are not set up. Review the documents manually.', 503)
  let response
  try {
    response = await fetchImpl(`${provider.baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.NINJA_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new RegistryError('REGISTRY_UNAVAILABLE', 'The registry service could not be reached. Try again later.', 503)
  }
  const parsed = await response.json().catch(() => null)
  if (!response.ok) {
    const type = parsed?.type || 'error'
    console.warn('[registry] request_rejected', JSON.stringify({ path, status: response.status, type }))
    if (response.status === 402) throw new RegistryError('REGISTRY_INSUFFICIENT_FUNDS', 'The verification wallet is empty. Top it up in the Ninja dashboard.', 402)
    if (response.status === 401) throw new RegistryError('REGISTRY_KEY_REJECTED', 'The verification key was rejected. Check NINJA_SECRET_KEY on the server.', 503)
    if (response.status === 429) throw new RegistryError('REGISTRY_RATE_LIMITED', 'Too many registry checks. Try again shortly.', 429)
    if (response.status === 400) throw new RegistryError('REGISTRY_INPUT_REJECTED', parsed?.message || 'The registry rejected these details.', 400)
    throw new RegistryError('REGISTRY_UNAVAILABLE', 'The registry service could not complete the check.', 503)
  }
  return { provider, body: parsed }
}

const normalise = (value) => String(value || '').toUpperCase().replace(/\b(LIMITED|LTD|NIGERIA|NIG|ENTERPRISES?|VENTURES?|COMPANY|CO|PLC|THE|AND|&)\b/g, ' ').replace(/[^A-Z0-9]+/g, ' ').trim()

/** Loose name comparison: every significant word of the shorter name appears in the other. */
export function namesMatch(a, b) {
  const left = normalise(a).split(' ').filter((word) => word.length > 1)
  const right = normalise(b).split(' ').filter((word) => word.length > 1)
  if (!left.length || !right.length) return false
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
  return shorter.every((word) => longer.includes(word))
}

export function cleanRegistrationNumber(value) {
  const text = String(value || '').toUpperCase().replace(/\s+/g, '')
  const match = /^(RC|BN|IT|LP|LLP)?-?(\d{4,9})$/.exec(text)
  return match ? { prefix: match[1] || null, digits: match[2] } : null
}

/** CAC lookup for a registered business. Returns { outcome, summary, providerReference }. */
export async function checkBusinessRegistration({ registrationNumber, businessName, reference }, { fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const number = cleanRegistrationNumber(registrationNumber)
  if (!number) throw new RegistryError('REGISTRATION_NUMBER_INVALID', 'The registration number should look like RC 1234567 or BN 1234567.')
  const { provider, body } = await ninja('/api/company/lookup', { rc_number: number.digits, reference }, fetchImpl)
  if (body?.status !== 'found' || !body.data) return { provider: provider.name, mode: provider.mode, outcome: 'NOT_FOUND', summary: { registrationNumber: number.digits }, providerReference: body?.id || null }
  const data = body.data
  const active = !/inactive|struck|dissolved|wound/i.test(String(data.status || ''))
  const nameMatches = namesMatch(data.name, businessName)
  return {
    provider: provider.name,
    mode: provider.mode,
    outcome: !active ? 'INACTIVE' : nameMatches ? 'MATCH' : 'NAME_MISMATCH',
    // Public registry facts only; director details are not stored.
    summary: { registeredName: data.name || null, registrationNumber: data.registration_number || number.digits, registryStatus: data.status || null, companyType: data.company_type || null, directorCount: Array.isArray(data.directors) ? data.directors.length : null, nameMatches },
    providerReference: body.id || null,
  }
}

const ID_TYPES = { 'national-id': 'nin', nin: 'nin', 'drivers-license': 'ndl', ndl: 'ndl', passport: 'passport', 'voters-card': 'vin', vin: 'vin' }

/** ID match for a rider (verify mode: returns a verdict, not the person's record). */
export async function checkRiderIdentity({ identityType, identityNumber, firstName, lastName, dateOfBirth, reference }, { fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const idType = ID_TYPES[String(identityType || '').toLowerCase()]
  if (!idType) throw new RegistryError('ID_TYPE_UNSUPPORTED', 'Automatic checks support NIN, driver’s licence, passport and voter’s card.')
  if (!identityNumber) throw new RegistryError('ID_NUMBER_MISSING', 'The rider has not provided an ID number.')
  if (['passport', 'vin'].includes(idType) && !dateOfBirth) throw new RegistryError('DATE_OF_BIRTH_REQUIRED', 'Passport and voter’s card checks need the rider’s date of birth.')
  const payload = { idType, mode: 'verify', idNumber: String(identityNumber).trim(), firstName, lastName, reference, ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth).toISOString().slice(0, 10) } : {}) }
  const { provider, body } = await ninja('/api/identity/identify', payload, fetchImpl)
  const outcome = body?.found === false ? 'NOT_FOUND' : body?.recommendation === 'accept' && body?.verified ? 'MATCH' : body?.recommendation === 'reject' ? 'NO_MATCH' : 'REVIEW'
  return {
    provider: provider.name,
    mode: provider.mode,
    outcome,
    summary: { idType, score: typeof body?.score === 'number' ? body.score : null, recommendation: body?.recommendation || null, mismatchedFields: Array.isArray(body?.mismatches) ? body.mismatches.map((entry) => entry.field || entry).slice(0, 6) : (body?.fields || []).filter((field) => field.match === false).map((field) => field.field).slice(0, 6) },
    providerReference: body?.id || null,
  }
}

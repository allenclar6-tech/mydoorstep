// Rules for attaching Google and phone sign-in to DOORSTEP accounts. One User row per person:
// Google identities are rows in AuthIdentity pointing at the same User an email/password sign-up made.
// Nothing is merged on an unverified email.

import { googleIsAuthoritativeFor } from './googleAuth.js'

export class LinkingError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}

const PROVIDER = 'google'

function splitName(identity) {
  const fallback = (identity.name || identity.email?.split('@')[0] || 'DOORSTEP').trim()
  const firstName = (identity.givenName || fallback.split(' ')[0] || 'DOORSTEP').slice(0, 80)
  const lastName = (identity.familyName || fallback.split(' ').slice(1).join(' ') || firstName).slice(0, 80)
  return { firstName, lastName }
}

/**
 * Resolves a verified Google identity to a customer account.
 * - Known Google identity → that account.
 * - Unknown identity, email already registered → linked only when that account is a customer whose email
 *   DOORSTEP already verified AND Google is authoritative for the address. Otherwise the person must sign in
 *   with their password and link Google from their account.
 * - Unknown identity, new email → a new customer account (terms must be accepted).
 */
export async function resolveGoogleSignIn(db, identity, { termsAccepted = false, now = new Date() } = {}) {
  if (!identity.email || !identity.emailVerified) throw new LinkingError('GOOGLE_EMAIL_NOT_VERIFIED', 'Your Google account has no verified email address. Sign up with email instead.', 400)

  const existingIdentity = await db.authIdentity.findUnique({ where: { provider_subject: { provider: PROVIDER, subject: identity.sub } }, include: { user: true } })
  if (existingIdentity) {
    const user = existingIdentity.user
    if (user.status !== 'ACTIVE') throw new LinkingError('ACCOUNT_UNAVAILABLE', 'This account is not active. Contact DOORSTEP support.', 403)
    if (user.role !== 'CUSTOMER') throw new LinkingError('GOOGLE_CUSTOMERS_ONLY', 'Google sign-in is for customer accounts. Partners, riders and admins sign in with their password.', 403)
    await db.authIdentity.update({ where: { id: existingIdentity.id }, data: { lastUsedAt: now, email: identity.email } })
    return { user, created: false, linked: false }
  }

  const byEmail = await db.user.findUnique({ where: { email: identity.email } })
  if (byEmail) {
    if (byEmail.role !== 'CUSTOMER') throw new LinkingError('GOOGLE_CUSTOMERS_ONLY', 'This email belongs to a partner, rider or admin account. Sign in with your password.', 403)
    if (byEmail.status !== 'ACTIVE') throw new LinkingError('ACCOUNT_UNAVAILABLE', 'This account is not active. Contact DOORSTEP support.', 403)
    if (!byEmail.emailVerifiedAt || !googleIsAuthoritativeFor(identity)) {
      throw new LinkingError('ACCOUNT_EXISTS_SIGN_IN_TO_LINK', 'An account with this email already exists. Sign in with your password, then connect Google from Account → Sign-in methods.')
    }
    await db.authIdentity.create({ data: { userId: byEmail.id, provider: PROVIDER, subject: identity.sub, email: identity.email, lastUsedAt: now } })
    return { user: byEmail, created: false, linked: true }
  }

  if (termsAccepted !== true) throw new LinkingError('TERMS_REQUIRED', 'Accept the DOORSTEP terms to create your account.', 400)
  const { firstName, lastName } = splitName(identity)
  const user = await db.user.create({
    data: {
      email: identity.email, passwordHash: null, firstName, lastName, role: 'CUSTOMER', emailVerifiedAt: now,
      customer: { create: {} },
      authIdentities: { create: { provider: PROVIDER, subject: identity.sub, email: identity.email, lastUsedAt: now } },
    },
  })
  return { user, created: true, linked: false }
}

/** A signed-in customer connects Google. The Google account must not already belong to someone else. */
export async function linkGoogle(db, user, identity, { now = new Date() } = {}) {
  if (user.role !== 'CUSTOMER') throw new LinkingError('GOOGLE_CUSTOMERS_ONLY', 'Google sign-in is for customer accounts.', 403)
  if (!identity.emailVerified) throw new LinkingError('GOOGLE_EMAIL_NOT_VERIFIED', 'That Google account has no verified email address.', 400)
  const existing = await db.authIdentity.findUnique({ where: { provider_subject: { provider: PROVIDER, subject: identity.sub } } })
  if (existing && existing.userId !== user.id) throw new LinkingError('GOOGLE_ALREADY_LINKED', 'That Google account is already connected to another DOORSTEP account.')
  if (existing) return { linked: false, alreadyLinked: true }
  const current = await db.authIdentity.findFirst({ where: { userId: user.id, provider: PROVIDER } })
  if (current) throw new LinkingError('GOOGLE_ALREADY_CONNECTED', 'A Google account is already connected. Disconnect it first.')
  await db.authIdentity.create({ data: { userId: user.id, provider: PROVIDER, subject: identity.sub, email: identity.email, lastUsedAt: now } })
  return { linked: true }
}

/** Disconnects Google, but never leaves the account without another way in. */
export async function unlinkGoogle(db, user) {
  const current = await db.authIdentity.findFirst({ where: { userId: user.id, provider: PROVIDER } })
  if (!current) return { unlinked: false }
  if (!user.passwordHash && !user.phoneVerifiedAt) throw new LinkingError('LAST_SIGN_IN_METHOD', 'Set a password first (Forgot password on the sign-in page), so you can still get into your account.')
  await db.authIdentity.delete({ where: { id: current.id } })
  return { unlinked: true }
}

/** Phone-code sign-in only works for a customer whose phone number DOORSTEP already verified. */
export async function resolvePhoneSignIn(db, phone) {
  const user = await db.user.findUnique({ where: { phone } })
  if (!user || !user.phoneVerifiedAt) return null
  if (user.status !== 'ACTIVE') throw new LinkingError('ACCOUNT_UNAVAILABLE', 'This account is not active. Contact DOORSTEP support.', 403)
  if (user.role !== 'CUSTOMER') throw new LinkingError('PHONE_CUSTOMERS_ONLY', 'Phone-code sign-in is for customer accounts. Partners, riders and admins sign in with their password.', 403)
  return user
}

import { createPublicKey, verify as verifySignature } from 'node:crypto'

// Verifies Google Identity Services ID tokens on the server, following
// https://developers.google.com/identity/gsi/web/guides/verify-google-id-token :
// RS256 signature against Google's published keys, `aud` = our client ID, `iss` = Google, not expired.
// No extra package is needed; Node's crypto reads Google's JWKs directly.

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const CLOCK_SKEW_SECONDS = 60

export class GoogleAuthError extends Error {
  constructor(code, message, status = 401) { super(message); this.code = code; this.status = status }
}

export function googleClientIds() {
  return String(process.env.GOOGLE_CLIENT_ID || '').split(',').map((value) => value.trim()).filter(Boolean)
}

export const googleSignInEnabled = () => googleClientIds().length > 0

let keyCache = { keys: new Map(), expiresAt: 0 }

async function googleKeys(fetchImpl, now) {
  if (keyCache.expiresAt > now && keyCache.keys.size) return keyCache.keys
  let response
  try {
    response = await fetchImpl(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new GoogleAuthError('GOOGLE_UNAVAILABLE', 'Google sign-in could not be checked. Try again.', 503)
  }
  if (!response.ok) throw new GoogleAuthError('GOOGLE_UNAVAILABLE', 'Google sign-in could not be checked. Try again.', 503)
  const body = await response.json()
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers?.get?.('cache-control') || '')?.[1] || 3600)
  keyCache = { keys: new Map((body.keys || []).map((jwk) => [jwk.kid, jwk])), expiresAt: now + Math.min(maxAge, 86_400) * 1000 }
  return keyCache.keys
}

export function resetGoogleKeyCache() { keyCache = { keys: new Map(), expiresAt: 0 } }

const decodeSegment = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))

/** Returns the verified claims of a Google ID token, or throws GoogleAuthError. */
export async function verifyGoogleIdToken(idToken, { fetchImpl = (...args) => globalThis.fetch(...args), now = Date.now(), clientIds = googleClientIds() } = {}) {
  if (!clientIds.length) throw new GoogleAuthError('GOOGLE_SIGN_IN_NOT_CONFIGURED', 'Google sign-in is not available yet.', 503)
  const parts = typeof idToken === 'string' ? idToken.split('.') : []
  if (parts.length !== 3 || idToken.length > 4096) throw new GoogleAuthError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.')
  let header
  let claims
  try { header = decodeSegment(parts[0]); claims = decodeSegment(parts[1]) } catch { throw new GoogleAuthError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.') }
  if (header.alg !== 'RS256' || !header.kid) throw new GoogleAuthError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.')

  let jwk = (await googleKeys(fetchImpl, now)).get(header.kid)
  if (!jwk) { resetGoogleKeyCache(); jwk = (await googleKeys(fetchImpl, now)).get(header.kid) } // Google rotated its keys.
  if (!jwk) throw new GoogleAuthError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.')

  const signedOk = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))
  if (!signedOk) throw new GoogleAuthError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.')

  const seconds = Math.floor(now / 1000)
  if (!ISSUERS.has(claims.iss)) throw new GoogleAuthError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.')
  if (!clientIds.includes(claims.aud)) throw new GoogleAuthError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.')
  if (!Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_SECONDS < seconds) throw new GoogleAuthError('GOOGLE_TOKEN_EXPIRED', 'Your Google sign-in expired. Try again.')
  if (Number.isFinite(claims.iat) && claims.iat - CLOCK_SKEW_SECONDS > seconds) throw new GoogleAuthError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.')
  if (!claims.sub || typeof claims.sub !== 'string') throw new GoogleAuthError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again.')
  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    hostedDomain: claims.hd || null,
    givenName: claims.given_name || null,
    familyName: claims.family_name || null,
    name: claims.name || null,
  }
}

/**
 * Google is authoritative for an address only for @gmail.com accounts, or a verified address on a
 * Google hosted domain (`hd`). Only then may a Google sign-in be attached to an existing DOORSTEP
 * account by email; otherwise the person must sign in another way first and link Google themselves.
 */
export function googleIsAuthoritativeFor(identity) {
  if (!identity.email || !identity.emailVerified) return false
  return identity.email.endsWith('@gmail.com') || Boolean(identity.hostedDomain)
}

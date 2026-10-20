// Rules for business registration status and rider approval readiness. Kept free of I/O so they can be
// unit-tested. Selling on DOORSTEP (application approval) is separate from being a verified *registered*
// business: an unregistered business can be approved to sell, but is never labelled as registered.

import { cleanRegistrationNumber } from './registryChecks.js'

export class VerificationRuleError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}

export const BUSINESS_STATUS_LABELS = {
  NOT_SUBMITTED: 'Not submitted',
  PENDING_REVIEW: 'Pending review',
  VERIFIED: 'Registered business verified',
  NON_REGISTERED: 'Non-registered business',
  ACTION_REQUIRED: 'Action required',
  REJECTED: 'Rejected',
}

/** Status a new (or resubmitted) application starts with. */
export function initialBusinessVerification({ registrationType, registrationNumber, hasCertificate }) {
  const type = registrationType || (registrationNumber ? 'REGISTERED' : 'NOT_REGISTERED')
  if (type === 'NOT_REGISTERED') return { registrationType: 'NOT_REGISTERED', businessVerificationStatus: 'NON_REGISTERED', businessVerificationNote: null }
  if (!cleanRegistrationNumber(registrationNumber)) return { registrationType: 'REGISTERED', businessVerificationStatus: 'ACTION_REQUIRED', businessVerificationNote: 'Add your CAC registration number (for example RC 1234567 or BN 1234567).' }
  if (!hasCertificate) return { registrationType: 'REGISTERED', businessVerificationStatus: 'ACTION_REQUIRED', businessVerificationNote: 'Upload your CAC certificate so we can confirm your registration.' }
  return { registrationType: 'REGISTERED', businessVerificationStatus: 'PENDING_REVIEW', businessVerificationNote: null }
}

/**
 * An admin's decision on business registration. "Verified" needs evidence: a registration number plus
 * either the uploaded certificate or a matching CAC registry check. A document upload alone never verifies.
 */
export function decideBusinessVerification(application, { decision, note }, { hasCertificate, hasRegistryMatch, reviewedCertificate = false }) {
  const trimmed = (note || '').trim()
  if (['ACTION_REQUIRED', 'REJECTED', 'NON_REGISTERED'].includes(decision) && trimmed.length < 5) throw new VerificationRuleError('NOTE_REQUIRED', 'Explain the decision so the business knows what to do.', 400)
  if (decision === 'VERIFIED') {
    if (application.registrationType !== 'REGISTERED') throw new VerificationRuleError('NOT_A_REGISTERED_BUSINESS', 'Only businesses that say they are registered can be marked as registered.')
    if (!cleanRegistrationNumber(application.registrationNumber)) throw new VerificationRuleError('REGISTRATION_NUMBER_MISSING', 'There is no valid CAC registration number on this application.')
    if (!hasRegistryMatch && !(hasCertificate && reviewedCertificate)) throw new VerificationRuleError('EVIDENCE_REQUIRED', 'Run a CAC registry check that matches, or open and confirm the uploaded certificate, before verifying.')
    return { businessVerificationStatus: 'VERIFIED', businessVerificationNote: trimmed || null }
  }
  if (decision === 'NON_REGISTERED') return { registrationType: 'NOT_REGISTERED', businessVerificationStatus: 'NON_REGISTERED', businessVerificationNote: trimmed }
  if (decision === 'ACTION_REQUIRED' || decision === 'REJECTED') return { businessVerificationStatus: decision, businessVerificationNote: trimmed }
  throw new VerificationRuleError('INVALID_DECISION', 'Unknown decision.', 400)
}

/** A rider can only be approved with identity evidence on file: an uploaded ID document or a matching ID check. */
export function riderApprovalBlocker({ documentCount, hasIdMatch }) {
  if (documentCount > 0 || hasIdMatch) return null
  return 'Ask the rider for an ID document (or run a matching ID check) before approving.'
}

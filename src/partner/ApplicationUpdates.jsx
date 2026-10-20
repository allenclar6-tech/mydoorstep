import { useState } from 'react'
import { BadgeCheck, CircleAlert, FileUp, Store } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { BusinessRegistrationField } from './BusinessRegistrationField'

const businessCopy = {
  NOT_SUBMITTED: { tone: 'neutral', icon: Store, title: 'Registration not stated', text: 'Tell us whether your business is registered with the CAC.' },
  PENDING_REVIEW: { tone: 'pending', icon: FileUp, title: 'Registration pending review', text: 'We are checking your CAC details. This does not hold up approval to sell.' },
  VERIFIED: { tone: 'good', icon: BadgeCheck, title: 'Registered business verified', text: 'Your store shows as a verified registered business.' },
  NON_REGISTERED: { tone: 'neutral', icon: Store, title: 'Non-registered business', text: 'You can sell on DOORSTEP without registration. Add your CAC details any time to get the verified badge.' },
  ACTION_REQUIRED: { tone: 'warn', icon: CircleAlert, title: 'Action required', text: 'We need something from you to confirm your registration.' },
  REJECTED: { tone: 'bad', icon: CircleAlert, title: 'Registration not confirmed', text: 'We could not confirm the registration details you sent.' },
}

const errors = { INVALID_CREDENTIALS: 'Your email or password is incorrect. Check them and try again.', TOO_MANY_DOCUMENTS: 'You have reached the document limit. Contact support.', NOTHING_TO_SUBMIT: 'Choose a document or update your registration first.', ALREADY_VERIFIED: 'Your registration is already verified.', UNSUPPORTED_DOCUMENT_TYPE: 'Only PDF, JPEG and PNG files are accepted.', DOCUMENT_TOO_LARGE: 'Each file must be 5 MB or smaller.', INVALID_PDF_SIGNATURE: 'That PDF could not be read.', INVALID_IMAGE_SIGNATURE: 'That image could not be read.', AUTH_RATE_LIMITED: 'Too many attempts. Wait a few minutes.' }

/** Business registration status, plus a form to send documents or registration details the reviewer asked for. */
export function ApplicationUpdates({ application, credentials, onSubmitted }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [changeRegistration, setChangeRegistration] = useState(false)
  const rider = application.type === 'RIDER'
  const business = application.business
  const info = business ? businessCopy[business.status] || businessCopy.NOT_SUBMITTED : null
  const canUpdateRegistration = business && business.status !== 'VERIFIED'
  const needsRegistration = business && ['ACTION_REQUIRED', 'REJECTED', 'NOT_SUBMITTED'].includes(business.status)
  const canUpload = ['PENDING_APPROVAL', 'NEEDS_INFORMATION'].includes(application.status) || needsRegistration

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    const data = new FormData(event.currentTarget)
    data.set('email', credentials.email)
    data.set('password', credentials.password)
    if (!data.getAll('documents').some((file) => file?.size) ) data.delete('documents')
    try {
      const response = await fetch(`${apiBase}/api/application-status/documents`, { method: 'POST', body: data })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(errors[body.error] || body.message || 'We could not send your update. Try again.')
      setMessage(body.uploaded ? `Sent ${body.uploaded} document${body.uploaded === 1 ? '' : 's'}. The DOORSTEP team has been notified.` : 'Your details were updated.')
      event.currentTarget.reset()
      setChangeRegistration(false)
      onSubmitted?.()
    } catch (submitError) { setError(submitError.message) } finally { setBusy(false) }
  }

  return <div className="app-updates">
    {info && <div className={`biz-status is-${info.tone}`}>
      <info.icon size={20} aria-hidden="true" />
      <div><strong>{info.title}</strong><p>{info.text}</p>{business.note && <p className="biz-status-note">{business.note}</p>}{business.registrationNumber && <small>Registration number on file: {business.registrationNumber}{business.hasCertificate ? ' · certificate uploaded' : ''}</small>}</div>
    </div>}
    {(canUpload || canUpdateRegistration) && <form className="app-updates-form" onSubmit={submit}>
      <h3>{application.status === 'NEEDS_INFORMATION' ? 'Send what the reviewer asked for' : rider ? 'Add documents' : 'Update your application'}</h3>
      {canUpdateRegistration && (needsRegistration || changeRegistration ? <BusinessRegistrationField defaultType={business.registrationType || ''} /> : <button type="button" className="alt-text-button" onClick={() => setChangeRegistration(true)}>{business.registrationType === 'REGISTERED' ? 'Update registration details' : 'My business is now registered'}</button>)}
      {canUpload && <label>{rider ? 'ID, licence or vehicle documents' : 'Other documents (optional)'}<input name="documents" type="file" accept="application/pdf,image/jpeg,image/png" multiple /></label>}
      {rider && !application.identityCheckConsent && <label className="terms-check"><input type="checkbox" name="identityCheckConsent" value="true" /> I agree that DOORSTEP may check my ID number and name against official records through its identity-verification partner. Only a match result is kept.</label>}
      <small>PDF, JPEG or PNG, up to 5 MB each. Files are private and only seen by authorised DOORSTEP staff.</small>
      {error && <div className="admin-login-error" role="alert">{error}</div>}
      {message && <p className="parcel-notice is-info" role="status">{message}</p>}
      <button type="submit" className="checkout-button" disabled={busy}>{busy ? 'Sending…' : 'Send to DOORSTEP'}</button>
    </form>}
  </div>
}

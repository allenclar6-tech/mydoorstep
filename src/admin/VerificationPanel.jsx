import { useEffect, useState } from 'react'
import { BadgeCheck, ChevronDown, SearchCheck, ShieldAlert } from 'lucide-react'
import { apiBase } from '../config/apiBase'

export const BUSINESS_STATUS = {
  NOT_SUBMITTED: ['Not submitted', 'pending'],
  PENDING_REVIEW: ['Pending review', 'pending'],
  VERIFIED: ['Registered business verified', 'active'],
  NON_REGISTERED: ['Non-registered business', 'neutral'],
  ACTION_REQUIRED: ['Action required', 'pending'],
  REJECTED: ['Rejected', 'danger'],
}
const OUTCOME = { MATCH: ['Match', 'active'], NAME_MISMATCH: ['Name does not match', 'pending'], INACTIVE: ['Company inactive', 'danger'], NOT_FOUND: ['Not found', 'danger'], REVIEW: ['Needs human review', 'pending'], NO_MATCH: ['No match', 'danger'] }

let providerPromise = null
function useRegistryProvider(token) {
  const [provider, setProvider] = useState(undefined)
  useEffect(() => {
    providerPromise ||= fetch(`${apiBase}/api/admin/verification/providers`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.ok ? response.json() : { registry: null }).catch(() => ({ registry: null }))
    providerPromise.then((body) => setProvider(body.registry))
  }, [token])
  return provider
}

const maskId = (value) => value ? `${'•'.repeat(Math.max(0, String(value).length - 4))}${String(value).slice(-4)}` : 'Not provided'

/** Registration / identity verification tools for one application card in the admin queue. */
export function VerificationPanel({ type, application, token, onChanged }) {
  const isBusiness = type !== 'rider'
  const provider = useRegistryProvider(token)
  const [open, setOpen] = useState(false)
  const [checks, setChecks] = useState(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [reviewedCertificate, setReviewedCertificate] = useState(false)
  const [message, setMessage] = useState('')
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const loadChecks = () => fetch(`${apiBase}/api/admin/applications/${type}/${application.id}/checks`, { headers }).then((response) => response.json()).then((body) => setChecks(body.checks || [])).catch(() => setChecks([]))
  useEffect(() => { if (open && checks === null) loadChecks() }, [open])

  const runCheck = async () => {
    setBusy('check'); setMessage('')
    try {
      const response = await fetch(`${apiBase}/api/admin/applications/${type}/${application.id}/registry-check`, { method: 'POST', headers })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || 'The check could not run.')
      setChecks((current) => [body.check, ...(current || [])])
    } catch (error) { setMessage(error.message) } finally { setBusy('') }
  }
  const decide = async (decision) => {
    setBusy(decision); setMessage('')
    try {
      const response = await fetch(`${apiBase}/api/admin/applications/${type}/${application.id}/business-verification`, { method: 'POST', headers, body: JSON.stringify({ decision, note: note || undefined, reviewedCertificate }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || 'Could not save the decision.')
      setMessage('Saved. The business has been notified.'); setNote(''); setReviewedCertificate(false)
      onChanged?.()
    } catch (error) { setMessage(error.message) } finally { setBusy('') }
  }

  const status = isBusiness ? BUSINESS_STATUS[application.businessVerificationStatus] || BUSINESS_STATUS.NOT_SUBMITTED : null
  const hasCertificate = isBusiness && (application.documents || []).some((document) => document.type === 'BUSINESS_REGISTRATION')
  const canCheck = provider && (isBusiness ? application.registrationType === 'REGISTERED' : Boolean(application.identityCheckConsentAt))
  const latest = checks?.[0]

  return <section className="verify-panel">
    <button type="button" className="verify-panel-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {isBusiness ? <BadgeCheck size={16} aria-hidden="true" /> : <SearchCheck size={16} aria-hidden="true" />}
      <span>{isBusiness ? 'Business registration' : 'Identity verification'}</span>
      {status && <span className={`admin-pill ${status[1]}`}>{status[0]}</span>}
      {!isBusiness && <span className={`admin-pill ${application.identityCheckConsentAt ? 'active' : 'pending'}`}>{application.identityCheckConsentAt ? 'Consented to ID check' : 'No ID-check consent'}</span>}
      <ChevronDown size={16} aria-hidden="true" className="verify-chevron" />
    </button>
    {open && <div className="verify-panel-body">
      {isBusiness ? <dl className="verify-facts">
        <div><dt>Says it is</dt><dd>{application.registrationType === 'REGISTERED' ? 'Registered with CAC' : application.registrationType === 'NOT_REGISTERED' ? 'Not registered' : 'Not stated'}</dd></div>
        <div><dt>RC / BN number</dt><dd>{application.registrationNumber || '—'}</dd></div>
        <div><dt>Certificate</dt><dd>{hasCertificate ? 'Uploaded (open it from Private documents)' : 'Not uploaded'}</dd></div>
        {application.businessVerificationNote && <div><dt>Last note</dt><dd>{application.businessVerificationNote}</dd></div>}
      </dl> : <dl className="verify-facts">
        <div><dt>ID type</dt><dd>{application.identityType || 'Not provided'}</dd></div>
        <div><dt>ID number</dt><dd>{maskId(application.identityNumber)}</dd></div>
        <div><dt>Documents</dt><dd>{(application.identityDocuments || []).length}</dd></div>
      </dl>}

      <div className="verify-checks">
        <div className="verify-checks-head"><strong>Registry checks</strong>
          {provider === null && <small>Automatic checks are off (no NINJA_SECRET_KEY). Review documents manually.</small>}
          {provider && <small>{provider.name}{provider.mode === 'sandbox' ? ' · SANDBOX (test data, not real records)' : ''}</small>}
        </div>
        {canCheck && <button type="button" className="row-more" disabled={busy === 'check'} onClick={runCheck}>{busy === 'check' ? 'Checking…' : isBusiness ? 'Look up on CAC register' : 'Check ID against records'}</button>}
        {provider && !canCheck && <small>{isBusiness ? 'Only businesses that say they are registered can be looked up.' : 'The rider has not consented to an automatic ID check.'}</small>}
        {checks === null && <small>Loading…</small>}
        {checks?.length === 0 && <small>No checks run yet.</small>}
        {latest && <div className={`verify-result is-${(OUTCOME[latest.outcome] || ['', 'pending'])[1]}`}>
          <strong>{(OUTCOME[latest.outcome] || [latest.outcome])[0]}</strong>
          {latest.summary?.registeredName && <span>Registered name: {latest.summary.registeredName}</span>}
          {latest.summary?.registryStatus && <span>Registry status: {latest.summary.registryStatus}</span>}
          {typeof latest.summary?.score === 'number' && <span>Match score: {Math.round(latest.summary.score * 100)}%</span>}
          {latest.summary?.mismatchedFields?.length > 0 && <span>Mismatched: {latest.summary.mismatchedFields.join(', ')}</span>}
          <small>{new Date(latest.createdAt).toLocaleString('en-NG')} · {latest.provider}</small>
        </div>}
      </div>

      {isBusiness && application.businessVerificationStatus !== 'VERIFIED' && <div className="verify-decide">
        <label>Note to the business<textarea rows="2" maxLength="1000" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Needed for “action required”, “not registered” and “reject”." /></label>
        {application.registrationType === 'REGISTERED' && hasCertificate && latest?.outcome !== 'MATCH' && <label className="terms-check"><input type="checkbox" checked={reviewedCertificate} onChange={(event) => setReviewedCertificate(event.target.checked)} /> I opened the certificate and it matches the business name and number.</label>}
        <div className="admin-application-actions">
          <button type="button" className="row-more" disabled={Boolean(busy)} onClick={() => decide('ACTION_REQUIRED')}>Ask for more</button>
          <button type="button" className="row-more" disabled={Boolean(busy)} onClick={() => decide('NON_REGISTERED')}>Treat as not registered</button>
          <button type="button" className="admin-review" disabled={Boolean(busy)} onClick={() => decide('REJECTED')}>Reject registration</button>
          {application.registrationType === 'REGISTERED' && <button type="button" className="admin-primary" disabled={Boolean(busy)} onClick={() => decide('VERIFIED')}><BadgeCheck size={14} /> Mark registered verified</button>}
        </div>
      </div>}
      {!isBusiness && <p className="verify-hint"><ShieldAlert size={14} aria-hidden="true" /> Approval needs at least one ID document or a matching ID check.</p>}
      {message && <div className="admin-login-error" role="status">{message}</div>}
    </div>}
  </section>
}

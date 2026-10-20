import { useState } from 'react'
import { BadgeCheck, Store } from 'lucide-react'

/**
 * "Is your business registered with CAC?" Registered businesses give their RC/BN number and certificate so
 * DOORSTEP can confirm it; non-registered businesses can still apply and are never asked for certificates.
 */
export function BusinessRegistrationField({ defaultType = '' }) {
  const [type, setType] = useState(defaultType)
  return <fieldset className="biz-reg">
    <legend>Is your business registered with the CAC?</legend>
    <div className="biz-reg-options">
      <label className={type === 'REGISTERED' ? 'is-selected' : ''}><input type="radio" name="registrationType" value="REGISTERED" required checked={type === 'REGISTERED'} onChange={() => setType('REGISTERED')} /><BadgeCheck size={18} aria-hidden="true" /><span><strong>Yes, it’s registered</strong><small>Limited company or business name (RC / BN)</small></span></label>
      <label className={type === 'NOT_REGISTERED' ? 'is-selected' : ''}><input type="radio" name="registrationType" value="NOT_REGISTERED" required checked={type === 'NOT_REGISTERED'} onChange={() => setType('NOT_REGISTERED')} /><Store size={18} aria-hidden="true" /><span><strong>Not registered yet</strong><small>You can still sell on DOORSTEP</small></span></label>
    </div>
    {type === 'REGISTERED' && <div className="biz-reg-details">
      <label>CAC registration number<input required name="registrationNumber" maxLength="20" placeholder="e.g. RC 1234567 or BN 1234567" pattern="\s*([Rr][Cc]|[Bb][Nn]|[Ii][Tt]|[Ll][Pp]|[Ll][Ll][Pp])?[\s\-]?\d{4,9}\s*" title="Enter your RC or BN number, for example RC 1234567." /></label>
      <label>CAC certificate (PDF, JPEG or PNG, up to 5 MB)<input required name="registrationCertificate" type="file" accept="application/pdf,image/jpeg,image/png" /></label>
      <small>We confirm this with the CAC register before showing “Registered business” on your store. Approval to sell does not depend on it.</small>
    </div>}
    {type === 'NOT_REGISTERED' && <p className="biz-reg-note">No certificate needed. Your store will show as an unregistered business, and you can add your registration later from your application status page.</p>}
  </fieldset>
}

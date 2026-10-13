import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function PasswordField({ label = 'Password', hint, labelClassName, ...inputProps }) {
  const [visible, setVisible] = useState(false)
  return <label className={labelClassName}>{label}<span className="password-field"><input {...inputProps} type={visible ? 'text' : 'password'} /><button aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible((current) => !current)} type="button">{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>{hint && <small className="field-hint">{hint}</small>}</label>
}

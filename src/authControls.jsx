import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { signOut } from './services/authService'

const apiBase = globalThis.location?.hostname === 'mydoorstep.com.co' ? '' : import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export function SessionSignOutButton({ className, admin = false, children = 'Sign out' }) {
  const [busy, setBusy] = useState(false)
  return <button type="button" className={className} disabled={busy} onClick={() => { setBusy(true); void signOut({ apiBase, admin }) }}><LogOut size={17} />{busy ? 'Signing out...' : children}</button>
}

export function SignOutNotice() {
  if (new URLSearchParams(window.location.search).get('logout') !== 'local') return null
  return <p className="admin-login-error" role="alert">You are signed out on this device, but we could not confirm that the server session ended. Check your connection and sign in again if needed. If this is a shared device, close the browser when finished.</p>
}

export function SignInLinks() {
  return <nav className="partner-registration-login" aria-label="Account sign-in options"><a href="/login">Customer login</a>{' · '}<a href="/partner/login">Partner sign in</a>{' · '}<a href="/rider/login">Rider sign in</a></nav>
}

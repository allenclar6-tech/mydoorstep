export function accountPathFor(role) {
  return role === 'RESTAURANT' ? '/restaurant/profile' : role === 'RIDER' ? '/rider/verification' : '/account'
}

export function loginPathFor(pathname, role) {
  if (pathname.startsWith('/admin/')) return '/admin/login'
  if (pathname.startsWith('/rider/') || pathname.startsWith('/riders/') || role === 'RIDER') return '/rider/login'
  if (pathname.startsWith('/restaurant/') || pathname.startsWith('/partner/') || pathname.startsWith('/partners/') || role === 'RESTAURANT') return '/partner/login'
  return '/login'
}

let pendingSignOut

export function signOut({ apiBase, admin = false }) {
  if (pendingSignOut) return pendingSignOut
  pendingSignOut = revokeAndRedirect(apiBase, admin).finally(() => { pendingSignOut = undefined })
  return pendingSignOut
}

async function revokeAndRedirect(apiBase, admin) {
  const key = admin ? 'doorstep-admin-token' : 'doorstep-token'
  const token = localStorage.getItem(key)
  const loginPath = admin ? '/admin/login' : loginPathFor(window.location.pathname, localStorage.getItem('doorstep-role'))
  localStorage.removeItem(key)
  if (!admin) localStorage.removeItem('doorstep-role')
  let revoked = true
  if (token) {
    try {
      const response = await fetch(`${apiBase}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      })
      revoked = response.ok || response.status === 401
      if (!revoked) console.warn('Session revocation failed with status', response.status)
    } catch {
      revoked = false
      console.warn('Session revocation could not reach the authentication service.')
    }
  }
  window.location.replace(`${loginPath}${revoked ? '' : '?logout=local'}`)
}

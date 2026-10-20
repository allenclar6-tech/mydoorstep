import { useCallback, useRef } from 'react'

/**
 * Sign-in only happens when the person acts. Password managers can fill the form the moment it appears
 * and some then submit it on their own; a real tap or key press is the only thing they cannot fake.
 * Spread `formProps` on the <form> and call `allowSubmit(event)` first in its submit handler.
 */
export function useManualSignIn() {
  const interacted = useRef(false)
  const markInteracted = useCallback((event) => { if (event.isTrusted) interacted.current = true }, [])
  const allowSubmit = useCallback((event) => {
    if (interacted.current) return true
    event.preventDefault()
    return false
  }, [])
  return { formProps: { onPointerDown: markInteracted, onKeyDown: markInteracted }, allowSubmit }
}

/**
 * Props that keep a field read-only until the person touches it, so saved credentials are not filled in
 * on page load. Tapping (or tabbing into) the field unlocks it, and the browser still offers the saved
 * email or password as a suggestion to pick.
 */
export const lockedUntilTouched = {
  readOnly: true,
  onPointerDown: (event) => { event.currentTarget.readOnly = false },
  onFocus: (event) => { event.currentTarget.readOnly = false },
}

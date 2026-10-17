const invalidApplicationErrors = new Set([
  'INVALID_PARTNER_APPLICATION',
  'INVALID_GROCERY_APPLICATION',
  'INVALID_RIDER_APPLICATION',
])

const applicationErrorMessages = {
  APPLICATION_EMAIL_VERIFICATION_REQUIRED: 'Your email verification has expired. Verify your email again before submitting.',
  CITY_NOT_SUPPORTED: 'Applications are not currently available in this city.',
  GROCERY_OWNER_ACCOUNT_ALREADY_EXISTS: 'An account with this email or phone number already exists.',
  PARTNER_ACCOUNT_ALREADY_EXISTS: 'An account with this email or phone number already exists.',
  PASSWORD_CONFIRMATION_MISMATCH: 'The passwords do not match.',
  RIDER_ACCOUNT_ALREADY_EXISTS: 'An account with this email or phone number already exists.',
}

export function validateOpeningHours(form) {
  const openingTime = form.elements.namedItem('openingTime')
  const closingTime = form.elements.namedItem('closingTime')
  if (!openingTime || !closingTime) return true

  const incomplete = Boolean(openingTime.value) !== Boolean(closingTime.value)
  openingTime.setCustomValidity(incomplete && !openingTime.value ? 'Enter both opening and closing times.' : '')
  closingTime.setCustomValidity(incomplete && !closingTime.value ? 'Enter both opening and closing times.' : '')
  if (!incomplete) return true

  ;(openingTime.value ? closingTime : openingTime).reportValidity()
  return false
}

export function applicationSubmissionError(body, form, fallback) {
  const fieldErrors = body?.details?.fieldErrors
  if (fieldErrors && typeof fieldErrors === 'object') {
    const messages = Object.entries(fieldErrors).flatMap(([name, errors]) => {
      if (!Array.isArray(errors)) return []
      const field = form?.elements?.namedItem(name)
      const label = name === 'openingTime'
        ? 'Opening and closing times'
        : field?.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || name.replaceAll(/([A-Z])/g, ' $1')
      return errors.filter((message) => typeof message === 'string').map((message) => `${label}: ${message}`)
    })
    if (messages.length) return messages.join(' ')
  }

  if (invalidApplicationErrors.has(body?.error)) return 'Some application details are incomplete or invalid. Review them and try again.'
  return applicationErrorMessages[body?.error] || fallback
}

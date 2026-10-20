const omittedFieldNames = new Set(['verificationCode', 'verificationId', 'password', 'confirmPassword', 'termsAccepted'])

export function getApplicationReview(form) {
  const fields = [...form.elements]
    .filter((field) => field.name && !omittedFieldNames.has(field.name) && !['hidden', 'password', 'file', 'checkbox', 'submit', 'button'].includes(field.type))
    .map((field) => ({
      label: field.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || field.name.replaceAll(/([A-Z])/g, ' $1'),
      value: field.tagName === 'SELECT' ? field.selectedOptions[0]?.textContent?.trim() : field.value.trim(),
      step: Number(field.closest('[data-onboarding-step], [data-grocery-step]')?.dataset.onboardingStep ?? field.closest('[data-grocery-step]')?.dataset.groceryStep ?? 0),
    }))
    .filter(({ value }) => value)

  const documents = [...form.querySelectorAll('input[type="file"]')].flatMap((field) => [...field.files].map((file) => ({ label: field.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || 'Document', value: file.name, step: Number(field.closest('[data-onboarding-step], [data-grocery-step]')?.dataset.onboardingStep ?? field.closest('[data-grocery-step]')?.dataset.groceryStep ?? 0) })))
  fields.push(...documents)
  const days = [...form.querySelectorAll('input[name="openingDays"]:checked')].map((field) => field.labels?.[0]?.textContent?.trim() || field.value)
  if (days.length) {
    const field = form.querySelector('input[name="openingDays"]')
    fields.push({ label: 'Opening days', value: days.join(', '), step: Number(field.closest('[data-onboarding-step], [data-grocery-step]')?.dataset.onboardingStep ?? field.closest('[data-grocery-step]')?.dataset.groceryStep ?? 0) })
  }

  return fields
}

export function ApplicationReviewSummary({ items, onEdit }) {
  if (!items.length) return <p>No optional details supplied. You can submit the required account details for review.</p>

  const groups = items.reduce((result, item) => {
    result[item.step] ||= []
    result[item.step].push(item)
    return result
  }, [])

  return <div className="application-review-summary">
    {groups.map((group, step) => group && <section key={step} aria-label={`Application step ${step + 1} details`}>
      <div className="application-review-heading"><strong>Step {step + 1}</strong><button type="button" className="quiet-button" onClick={() => onEdit(step)}>Edit</button></div>
      <dl>{group.map(({ label, value }, index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>)}
  </div>
}

const draftExcludedTypes = new Set(['hidden', 'password', 'file', 'checkbox', 'submit', 'button'])

export function saveApplicationDraft(form, storageKey, currentStep, resumeStep = 2) {
  const fields = [...form.elements]
  const values = Object.fromEntries(fields
    .filter((field) => field.name && !omittedFieldNames.has(field.name) && !draftExcludedTypes.has(field.type))
    .map((field) => [field.name, field.value]))
  const checkboxGroups = new Map()
  for (const field of fields.filter((item) => item.type === 'checkbox' && item.name && !omittedFieldNames.has(item.name))) {
    checkboxGroups.set(field.name, [...(checkboxGroups.get(field.name) || []), ...(field.checked ? [field.value] : [])])
  }
  for (const [name, selectedValues] of checkboxGroups) values[name] = selectedValues
  const resumableStep = currentStep >= 3 ? resumeStep : currentStep
  const draft = { values, step: resumableStep, savedAt: new Date().toISOString() }
  sessionStorage.setItem(storageKey, JSON.stringify(draft))
  return draft
}

export function restoreApplicationDraft(form, storageKey) {
  const serialized = sessionStorage.getItem(storageKey)
  if (!serialized) return null

  let draft
  try {
    draft = JSON.parse(serialized)
  } catch {
    sessionStorage.removeItem(storageKey)
    console.warn('[onboarding] discarded an unreadable saved draft')
    return null
  }
  if (!draft || typeof draft.values !== 'object' || !Number.isInteger(draft.step)) {
    sessionStorage.removeItem(storageKey)
    console.warn('[onboarding] discarded an invalid saved draft')
    return null
  }

  for (const [name, value] of Object.entries(draft.values)) {
    const field = form.elements.namedItem(name)
    if (Array.isArray(value)) {
      for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) {
        if (checkbox.name === name) checkbox.checked = value.includes(checkbox.value)
      }
    } else if (field && typeof value === 'string' && !draftExcludedTypes.has(field.type)) {
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }
  return draft
}

export function clearApplicationDraft(storageKey) {
  try {
    sessionStorage.removeItem(storageKey)
  } catch {
    console.warn('[onboarding] could not clear the saved draft')
  }
}

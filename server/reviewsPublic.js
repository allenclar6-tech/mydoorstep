// Public reviews on store and item pages (Glovo-style): a thumbs-up share, who wrote it (first name + initial),
// what they ordered, and per-item thumbs. Only reviews an admin approved (moderatedAt set) are ever shown.

export const PUBLIC_REVIEW_SELECT = {
  id: true, rating: true, body: true, createdAt: true, itemFeedback: true,
  user: { select: { firstName: true, lastName: true } },
  order: { select: { items: { select: { menuItemId: true, nameSnapshot: true, quantity: true } } } },
}

/** "Ejiro E." — never the full surname, email or phone. */
export function authorName(user) {
  const first = String(user?.firstName || '').trim()
  const initial = String(user?.lastName || '').trim().charAt(0)
  if (!first) return 'DOORSTEP customer'
  return initial ? `${first} ${initial.toUpperCase()}.` : first
}

const feedbackOf = (review) => (Array.isArray(review.itemFeedback) ? review.itemFeedback : []).filter((entry) => entry && entry.menuItemId && typeof entry.liked === 'boolean')

export function publicReview(review) {
  const items = (review.order?.items || []).map((item) => ({ menuItemId: item.menuItemId, name: item.nameSnapshot, quantity: item.quantity }))
  return {
    id: review.id,
    liked: review.rating >= 4,
    rating: review.rating,
    body: review.body || null,
    createdAt: review.createdAt,
    author: authorName(review.user),
    items,
    itemFeedback: feedbackOf(review).map(({ menuItemId, name, liked }) => ({ menuItemId, name, liked })),
  }
}

/** Per item: how many reviewers gave it a thumbs-up, out of how many rated it. */
export function itemStats(reviews) {
  const stats = {}
  for (const review of reviews) {
    for (const entry of feedbackOf(review)) {
      const row = stats[entry.menuItemId] || (stats[entry.menuItemId] = { liked: 0, total: 0 })
      row.total += 1
      if (entry.liked) row.liked += 1
    }
  }
  return stats
}

/** Whether a review mentions an item: rated it, or simply had it in the order. */
export const reviewMentionsItem = (review, menuItemId) => feedbackOf(review).some((entry) => entry.menuItemId === menuItemId) || (review.order?.items || []).some((item) => item.menuItemId === menuItemId)

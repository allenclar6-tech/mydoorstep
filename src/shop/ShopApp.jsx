import { useEffect, useState } from 'react'
import { DiscoverPage, VerticalPage } from './BrowsePages'
import { CheckoutPage } from './Checkout'
import { FaqPage, ProfileHub, PromosPage } from './ProfileHub'
import { ShopHome } from './ShopHome'
import { StorePage } from './StorePage'
import { BusinessLanding, RiderLanding } from './PartnerLanding'
import { Toaster } from './Toaster'
import { DesktopFooter, DesktopNav } from './ShopKit'
import { applyAppearance, verticalForPath } from './shopData'
import './shop.css'

// The DOORSTEP customer app: home, sections, Discover, store pages, checkout and profile.

const clean = (path) => path.replace(/\/$/, '') || '/'

/** Paths this module draws (everything else stays with the older pages). */
export function isShopPath(rawPath) {
  const path = clean(rawPath)
  if (['/', '/food', '/restaurants', '/groceries', '/shops', '/pharmacy', '/discover', '/checkout', '/cart', '/profile', '/account/promos', '/help/faq', '/partner/register', '/partners/restaurants', '/riders'].includes(path)) return true
  return /^\/(store|restaurants|groceries)\/[^/]+$/.test(path)
}

export function ShopApp() {
  const [location, setLocation] = useState(() => `${window.location.pathname}${window.location.search}`)
  useEffect(() => {
    applyAppearance()
    const sync = () => setLocation(`${window.location.pathname}${window.location.search}`)
    window.addEventListener('popstate', sync)
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onScheme = () => applyAppearance()
    media?.addEventListener?.('change', onScheme)
    return () => { window.removeEventListener('popstate', sync); media?.removeEventListener?.('change', onScheme); document.documentElement.dataset.shopTheme = 'light' }
  }, [])
  const path = clean(location.split('?')[0])
  const vertical = verticalForPath(path)
  let page
  if (path === '/') page = <ShopHome />
  else if (vertical) page = <VerticalPage key={vertical.key} vertical={vertical.key} />
  else if (path === '/discover') page = <DiscoverPage key={location} />
  else if (path === '/checkout' || path === '/cart') page = <CheckoutPage />
  else if (path === '/profile') page = <ProfileHub />
  else if (path === '/account/promos') page = <PromosPage />
  else if (path === '/help/faq') page = <FaqPage />
  else if (path === '/partner/register' || path === '/partners/restaurants') page = <BusinessLanding />
  else if (path === '/riders') page = <RiderLanding />
  else { const slug = decodeURIComponent(path.split('/')[2] || ''); page = <StorePage key={slug} slug={slug} /> }
  return <div className="sp-app"><DesktopNav />{page}<DesktopFooter /><Toaster /></div>
}

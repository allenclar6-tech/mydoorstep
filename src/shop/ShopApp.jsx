import { lazy, Suspense, useEffect, useState } from 'react'
import { DiscoverPage, VerticalPage } from './BrowsePages'
import { CheckoutPage } from './Checkout'
import { FaqPage, ProfileHub, PromosPage } from './ProfileHub'
import { ShopHome } from './ShopHome'
import { StorePage } from './StorePage'
import { BusinessLanding, RiderLanding } from './PartnerLanding'
import { Toaster } from './Toaster'
import { AddressBookPage, AddressEditorPage, PinPickerPage } from './AddressEditor'
import { AddCardPage, PaymentMethodsPage } from './CardsPages'

// The package screens carry the map code, so they load only when someone opens “Send a package”.
const ParcelRoutes = lazy(() => import('../parcel/ParcelRoutes'))
import { DesktopFooter, DesktopNav } from './ShopKit'
import { applyAppearance, verticalForPath } from './shopData'
import './shop.css'

// The DOORSTEP customer app: home, sections, Discover, store pages, checkout and profile.

const clean = (path) => path.replace(/\/$/, '') || '/'

/** Paths this module draws (everything else stays with the older pages). */
export function isShopPath(rawPath) {
  const path = clean(rawPath)
  if (['/', '/food', '/restaurants', '/groceries', '/shops', '/pharmacy', '/discover', '/checkout', '/cart', '/profile', '/account/promos', '/help/faq', '/partner/register', '/partners/restaurants', '/riders', '/location', '/address/new', '/account/addresses', '/account/cards', '/account/cards/new', '/send'].includes(path)) return true
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
  else if (path === '/location') page = <PinPickerPage key={location} />
  else if (path === '/address/new') page = <AddressEditorPage key={location} />
  else if (path === '/account/addresses') page = <AddressBookPage />
  else if (path === '/account/cards') page = <PaymentMethodsPage key={location} />
  else if (path === '/account/cards/new') page = <AddCardPage />
  else if (path === '/send') page = <Suspense fallback={<div className="sp-screen"><div className="sp-skeletons" role="status" aria-label="Loading"><div className="sp-skeleton" /></div></div>}><ParcelRoutes path="/send" /></Suspense>
  else { const slug = decodeURIComponent(path.split('/')[2] || ''); page = <StorePage key={slug} slug={slug} /> }
  if (path === '/location') return <div className="sp-app is-fullmap">{page}<Toaster /></div>
  return <div className="sp-app"><DesktopNav />{page}<DesktopFooter /><Toaster /></div>
}

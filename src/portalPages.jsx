import { RestaurantOrderBoard } from './live/RestaurantOrderBoard'
import { PickupToggle } from './live/PickupToggle'
import { SetupChecklist } from './partner/SetupChecklist'
import { PushPrompt } from './notifications/PushPrompt'
import { InstallApp } from './app/InstallApp'
import './partnerAccount.css'
import { WorkspaceInbox } from './notifications/NotificationCenter'
import { ProfileCompletenessCard } from './account/ProfileCompleteness'
import { HelpPage } from './support/HelpChat'
import { Wallet } from './finance/Wallet'
import { WithdrawBanner } from './finance/WithdrawButton'
import { SignInMethodsPage } from './auth/AltSignIn'
import { PartnerAccount } from './PartnerAccount'
import { PartnerMenu } from './PartnerMenu'
import { PartnerShell, PartnerToday, usePartner } from './partner/PartnerHub'

// Business workspace (restaurants, groceries and shops). The shell and "Today" screen live in partner/PartnerHub.jsx.

function Orders() { return <><PickupToggle /><RestaurantOrderBoard /></> }

function Earnings() { return <Wallet kind="RESTAURANT" /> }

function Today() {
  const grocery = usePartner().today?.store?.storeType === 'GROCERY'
  return <PartnerToday extras={<>
    <InstallApp who="business" />
    <PushPrompt who="business" />
    <SetupChecklist grocery={grocery} />
    <WithdrawBanner earningsHref="/restaurant/earnings" title={grocery ? 'Store balance' : 'Your DOORSTEP balance'} />
    <ProfileCompletenessCard className="ws-pc" />
  </>} />
}

export function RestaurantPortal({ path }) {
  let content = <Today />
  if (path === '/restaurant/orders') content = <Orders />
  if (path === '/restaurant/menu' || path === '/restaurant/menu/new') content = <PartnerMenu />
  if (path === '/restaurant/profile' || path === '/restaurant/settings') content = <PartnerAccount initialSection="business" />
  if (path === '/restaurant/support') content = <HelpPage embedded />
  if (path === '/restaurant/security') content = <SignInMethodsPage backHref="/restaurant/profile" />
  if (path === '/restaurant/notifications') content = <WorkspaceInbox title="Notifications" subtitle="New orders, rider arrivals, payouts and messages from DOORSTEP." />
  if (path === '/restaurant/earnings') content = <Earnings />
  return <PartnerShell path={path}>{content}</PartnerShell>
}

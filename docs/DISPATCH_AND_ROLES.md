# Staff roles, business delivery deals, dispatch control, routing and road reports (10 Nov)

This update adds the parts of the Glovo-style brief that were approved: admin staff roles, business delivery
deals, dispatch control with a delivery overview, road routing with rider road reports, extra delivery
charges (night, difficult access), rider waiting pay, scheduled price changes, and demand-based pricing
(built but **off**, and only the Super admin can turn it on).

## Permanent business rules (checked by `tests/businessRules.test.js`)

1. Customers can't negotiate, bargain or ask for a better delivery price. There's no button or API for it.
2. Customers can only **accept** or **decline** a delivery price DOORSTEP sends.
3. Admins (and riders, through price checks) decide exceptional delivery prices.
4. Demand-based (surge) pricing is off by default. Only the Super admin can switch it on.
5. Every pricing setting is managed from Admin › Delivery prices. No code changes are needed.
6. Prices are worked out and checked on the server. The browser never sends a price that's trusted.
7. Every price change is recorded in the activity log. It can be scheduled to switch on at a set time.
8. Customers never see rider pay, rider percentages or DOORSTEP's margin.

Changing any of these needs the platform owner's explicit say-so.

## What each part does

### Staff roles (Admin › Staff & roles)
Each admin account has a role. The server checks the role on every `/api/admin/...` request, so hiding a
menu item isn't the only protection.

| Role | Can use |
|---|---|
| Super admin | Everything: staff, settings, and switching on demand-based pricing |
| Delivery manager | Deliveries, prices to confirm, rider price checks, dispatch, road reports, areas |
| Pricing manager | Delivery prices, areas, business delivery deals, prices to confirm |
| Finance admin | Money, payouts, refunds, books and statements |
| Dispatch operator | Live deliveries, assigning riders, order chats, customer help |

- Existing admin accounts become **Super admin** automatically, so nothing changes for you.
- New staff are added by email. They set their password with "Forgot password" on the admin sign-in page.
- You can't remove or suspend the last Super admin. Suspending someone signs them out straight away.
- Alerts go only to staff whose role covers the page the alert links to.

### Business delivery deals (Admin › Business delivery deals)
Per business, choose who pays the delivery fee:

| Deal | Customer pays | Business pays | DOORSTEP pays |
|---|---|---|---|
| Standard | the fee | — | — |
| Business pays | nothing | the fee | — |
| Shared | the rest | a % (optional cap) | — |
| Fixed fee | a fixed amount | the gap (if chosen) | or DOORSTEP covers the gap |
| DOORSTEP pays | nothing | — | the fee |

You can also set "free delivery when the basket is at least ₦X" and say who pays for it. Deals can have
start and end dates. The rider is always paid in full. The business's part comes out of its order payout,
and the books show it as a "Delivery contribution" line. The customer sees only their own price, with a
short note such as "Delivery paid by the store". The business sees its deal under Statement.

### Dispatch control (Admin › Live deliveries)
- **Take off / reassign** (before pickup): remove the rider, with a reason. Offer the job to a chosen online
  rider or let automatic dispatch offer it again.
- **Delivery failed** (after pickup): choose a reason, add notes, the refund to the customer and the rider's
  pay for the trip. It cancels the order, creates a refund to process in Money › Refunds, pays the rider, and
  logs everything. Nothing is deleted.
- **I've arrived** (rider app): the rider taps it at the customer. If waiting pay is on, waiting time after the
  free minutes is paid to the rider by DOORSTEP. **It isn't charged to the customer.**

### Delivery overview (Admin › Delivery overview)
This page shows:
- **Right now:** deliveries on the way, deliveries waiting for a rider, prices still to set, prices waiting for customers, and route checks.
- **For any period:** deliveries done and failed, delivery income, rider pay, the margin and the average fee, with daily or weekly charts.
- **Per rider:** how many offers they accepted, how many deliveries they completed or failed, their average time, rating and earnings.

### Routing and road reports
- Road distances come from your own OSRM server (free) and/or Mapbox. See `docs/ROUTING.md`.
- **Rider › Road reports:** riders report bad roads, closures, access problems, real distances, landmarks
  and suggested extra charges, with an optional GPS spot.
- **Admin › Road reports:** approve or reject them. Approved reports show as hints when you set a price in
  Prices to confirm. Each hint shows how many riders agree with it, and hints over 90 days old are marked as old.
  Reports never change prices by themselves.

### Extra charges, waiting pay, scheduling and demand (Admin › Delivery prices › Fees & rider rates)
- **Night deliveries:** sets the hours (Lagos time), the customer charge and an extra for the rider. Off until you switch it on.
- **Difficult access:** a charge per area, set in the Sapele areas tab. 0 means no charge.
- **Rider waiting pay:** free minutes, then a rate per minute, up to a maximum. DOORSTEP pays it. Off by default.
- **Demand-based pricing:** off. When the Super admin switches it on, the fee rises in steps while many
  orders are waiting per free rider, within a maximum % and a maximum ₦. It can be limited to chosen areas.
  Customers see it as its own "High demand" line before they pay.
- **Only deliver inside approved delivery areas:** this switch refuses addresses outside every area at checkout.
- **Schedule:** pick a time in "Switch on at" and press Schedule. The change switches on within a minute of
  that time and is logged. You can cancel it from the banner at the top.
- **Pricing simulator:** the "Test a trip" tab works out any trip with the unsaved settings and shows the price breakdown.

## Customer checkout workflow
1. The customer picks an address with a map pin.
2. **Sure distance** (exact pins, road route found): the fee is shown straight away, with any extra charges listed. The customer pays.
3. **Unsure place** (no pin, or the distance isn't reliable): the checkout shows "Delivery: To be confirmed". DOORSTEP prices it (riders can be asked first).
4. The customer gets the price and taps **Accept** (then Pay) or **Decline** (the order is cancelled, nothing is paid).
5. An expired or replaced price can't be paid.

## Courier dispatch workflow
1. When an order is ready, an online rider is offered the job. They accept or decline.
2. The rider goes to the store and marks pickup, then goes to the customer and taps **I've arrived** there.
3. They deliver the order and confirm with the customer's code or proof.
4. If there's a problem, dispatch can take the rider off before pickup and reassign the job. After pickup, a failed delivery is closed with a refund and fair pay for the rider.
5. The rider's pay for each job, including any night extra and waiting pay, shows in their statement and in Admin › Books.

## API (all `/api/...`; admin routes need a staff session with the right role)

| Method & path | Role area | What it does |
|---|---|---|
| `GET /admin/me` | any staff | Your role, areas, the pages you can open, and whether you're the owner |
| `GET/POST /admin/staff`, `PATCH /admin/staff/:id` | people | List, add, change the role of, suspend or reactivate staff |
| `GET /admin/merchant-deals?q=` | pricing | Businesses with their delivery deal |
| `POST /admin/merchant-deals/preview` | pricing | Shows who pays what for a fee and basket |
| `PUT /admin/merchant-deals/:restaurantId` | pricing | Saves a deal (logged as `DELIVERY_DEAL_CHANGED`) |
| `GET /restaurant/delivery-deal` | business | The business's own deal |
| `POST /admin/deliveries/:id/unassign` | dispatch | Takes the rider off before pickup; optional `riderId` to offer the job to |
| `GET /admin/delivery-failure-reasons` | dispatch | The reasons a delivery can fail |
| `POST /admin/deliveries/:id/fail` | dispatch | Closes a failed delivery (refund, rider pay, log) |
| `POST /deliveries/:id/arrived` | rider | Marks "I've arrived" at the customer |
| `GET /admin/delivery-overview?from=&to=` | overview | The delivery overview figures |
| `POST/GET /rider/road-reports` | rider | Sends a report, or lists your own reports |
| `GET /admin/road-reports?status=` | zones | Reports to review |
| `POST /admin/road-reports/:id/review` | zones | Approves or rejects a report |
| `GET /admin/road-reports/suggestions` | quotes | Hints for a place being priced |
| `GET/PUT /admin/delivery-pricing` | pricing | Settings; `activatesAt` schedules a change; demand changes are owner-only |
| `DELETE /admin/delivery-pricing/scheduled` | pricing | Cancels a scheduled change |

## Database migrations (all additive: new columns and tables only)
- `20261110100000_staff_roles`: adds `User.adminRole`. Empty means Super admin.
- `20261110110000_merchant_delivery_deals`: adds `Restaurant.deliveryDeal`, `Order.deliveryFunding` and `DeliveryQuotationVersion.funding`.
- `20261110120000_dispatch_control`: adds `Delivery.arrivedAtCustomerAt`, `failedAt`, `failureReason` and `failureNote`.
- `20261110130000_road_reports`: adds the new `RoadReport` table.

They run automatically when the API starts (`node server/migrate.js`).

## Settings (environment variables)

| Variable | Needed? | Notes |
|---|---|---|
| `ROUTING_PROVIDERS` | optional | Default `mapbox,osrm`. Recommended `osrm,mapbox`. |
| `OSRM_URL` | optional | Your OSRM server, e.g. `http://osrm:5000`. Free. |
| `MAPBOX_SERVER_TOKEN` | optional | Already used before. Paid beyond the free allowance. Server only. |

No new paid services are required. With neither routing setting, pricing still works (exact pins use the
straight line × detour allowance; unsure places go to Prices to confirm).

## Files
**New (server):** `server/staff.js`, `server/merchantDeals.js`, `server/merchantDealRoutes.js`,
`server/dispatchControl.js`, `server/dispatchRoutes.js`, `server/deliveryOverview.js`, `server/roadReports.js`.

**New (app):** `src/admin/Staff.jsx`, `src/admin/staff.css`, `src/admin/MerchantDeals.jsx`, `src/admin/merchantDeals.css`,
`src/admin/DeliveryOverview.jsx`, `src/admin/deliveryOverview.css`, `src/admin/RoadReports.jsx`, `src/rider/RoadReports.jsx`.

**New (tests and docs):** `tests/staffRoles.test.js`, `tests/merchantDeals.test.js`, `tests/dispatchControl.test.js`,
`tests/routingAndSurcharges.test.js`, `tests/businessRules.test.js`, `docs/DISPATCH_AND_ROLES.md`, `docs/ROUTING.md`,
`docs/DEPLOY_PROMPT_10NOV.md`.

**Changed:** `prisma/schema.prisma`, `package.json` (test list only), `.env.example`, `server/auth.js`, `server/index.js`,
`server/bookkeeping.js`, `server/deliveryAssessment.js`, `server/deliveryPricing.js`, `server/deliveryPricingRoutes.js`,
`server/deliveryPricingSettings.js`, `server/deliveryQuote.js`, `server/deliveryService.js`, `server/financeLedger.js`,
`server/financeService.js`, `server/locations.js`, `server/notify.js`, `server/parcelRoutes.js`, `server/parcelService.js`,
`server/quotationService.js`, `server/supportRoutes.js`, `src/admin/AdminHub.jsx`, `src/admin/DeliveryPricing.jsx`,
`src/admin/deliveryPricing.css`, `src/admin/DeliveryQuotes.jsx`, `src/admin/DispatchBoard.jsx`, `src/adminPages.jsx`,
`src/chat/orderChat.css`, `src/finance/MyStatement.jsx`, `src/live/live.css`, `src/partner/partnerHub.css`,
`src/rider/RiderHub.jsx`, `src/rider/priceChecks.css`, `src/riderPages.jsx`, `src/shop/Checkout.jsx`, `src/shop/OrdersPages.jsx`.

## Test results (run on 10 Nov in Claude's workspace)
- `npm test` file list: **253 of 256 passed**. The 3 that didn't run (`api`, `navigation`, `partnerMedia`)
  need the `supertest` package, which isn't installed in that workspace. They should be run on your laptop.
- That includes the 8-point business-rules audit (8/8), staff roles (5), business deals (6), dispatch control (6)
  and routing & charges (7).
- A syntax and reference check of all 258 source files found 0 issues.
- The new screens were checked at phone (390 px) and desktop (1200 px) widths: Staff & roles, Business delivery deals,
  Delivery overview, Road reports (admin and rider), dispatch controls and the new pricing cards.
- **Not yet tested against a real database:** `npx prisma validate`, `npm run build` and the live flows. The deploy
  prompt has VS Code do these.

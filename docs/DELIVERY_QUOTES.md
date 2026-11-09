# Delivery pricing: automatic, fixed-area and manual (negotiated) prices

DOORSTEP prices every delivery on the server; the browser never sends a price. There are three ways a fee is set:

| Method | When | Recorded as |
|---|---|---|
| **A. Distance** | Reliable road distance between the store's pin and the customer's pin | `DISTANCE` |
| **C. Fixed area / agreed route** | The customer's area has a fixed price, or the two areas have an agreed route price | `AREA_FIXED`, `ROUTE_RULE` |
| **B. Manual quote** | The address can't be mapped, the distance isn't reliable, the trip is longer than usual, or the fee is above the automatic limit | `MANUAL_QUOTE` (`NEGOTIATED`, `FREE_DELIVERY` when the admin chooses those) |

Plus `FREE_THRESHOLD` (free delivery over a basket amount) and `PICKUP`. There is **no flat or "typical trip" fee** any more: if prices aren't published, or the address has no map position, the order waits for a confirmed price.

## Priority (never mixed)

Default (*Delivery prices › Extras › Fixed area prices and agreed route prices* = "Agreed route prices, otherwise the real km"):

1. An admin-approved quote for that order (applied when the customer accepts it)
2. An agreed area-to-area route price (a deal made with riders for that pair of areas)
3. The distance formula on the **real kilometres**: base fee + extra km × rate, then minimum / maximum, surcharges (area, remote, weekend, busy-time), margin protection and rounding — whenever the km were measured reliably (road route, or straight line between two exact pins)
4. The drop-off area's fixed price, only when the km couldn't be measured reliably
5. Otherwise → manual quote (the order waits for a confirmed price)

The other two settings ("Always use the area's fixed price" / "Always use the agreed route price") make those prices win over the km.

The method that produced the fee is stored on the order (`deliveryPricingMethod`) with the distance status and confidence.

## Distance status and confidence (`server/deliveryAssessment.js`)

| Status | Meaning | Confidence |
|---|---|---|
| `VERIFIED_ROAD_DISTANCE` | Mapbox road route between two exact pins, passed the sanity checks | HIGH |
| `ESTIMATED_ROAD_DISTANCE` | Road route with a capped detour, or measured to an area's centre | MEDIUM |
| `UNVERIFIED_DISTANCE` | Road route, but the store hasn't pinned itself (its area centre was used) | LOW |
| `STRAIGHT_LINE_DISTANCE` | No usable route (routing down, no route, suspicious route): straight line × detour allowance — never presented as road distance | **MEDIUM** when the store's own pin and the customer's pin are both exact (charged by the km automatically; switch: *Charge by the km automatically when … exact map pins*), otherwise LOW |
| `UNAVAILABLE_DISTANCE` | No pin for the customer or the store | UNVERIFIED — always a manual price, even with manual prices switched off |

Each order's quote keeps a distance record: km, provider (`mapbox`/`none`), time, both coordinates, route status, verification status, road km and straight-line km. An admin correction is stored next to it (`correctedDistanceKm`, reason, who, when); the original is never overwritten.

*Admin › Delivery prices › Prices DOORSTEP confirms by hand* sets: on/off, the confidence below which a manual price is required (default **Medium**), whether trips beyond the maximum distance get a manual price instead of being refused, an optional fee above which a manual price is required, the highest price an admin may send, how long a price stays valid.

## Order and quote lifecycle

```
Checkout ──(reliable)──────────────────────────────────────► PENDING_PAYMENT → PAID → … (unchanged)
   └──(needs a person)──► AWAITING_DELIVERY_QUOTE  (quote PENDING_REVIEW, nothing charged)
          admin asks riders (optional) ─► riders agree / give their price / pass
          admin sets rider pay + customer price ─► quote QUOTE_SENT ─┬─ customer accepts ─► quote QUOTE_ACCEPTED, order PENDING_PAYMENT (rider pay fixed on the order)
                                                 ├─ admin revises (QUOTE_REVISED, fresh acceptance needed)
                                                 ├─ customer declines ─► QUOTE_DECLINED, order CANCELLED
                                                 └─ not answered in time ─► QUOTE_EXPIRED (admin sends a new price or cancels)
          admin "Can't deliver" ─► QUOTE_CANCELLED, order CANCELLED
```

Mapping to the requested states: LOCATION_SUBMITTED / LOCATION_REVIEW_REQUIRED / PENDING_DELIVERY_QUOTE = order `AWAITING_DELIVERY_QUOTE` + quote `PENDING_REVIEW`; DELIVERY_QUOTE_SENT = quote `QUOTE_SENT`/`QUOTE_REVISED`; DELIVERY_QUOTE_ACCEPTED/DECLINED = quote status; the rest are DOORSTEP's existing order statuses. The same order record is used throughout (no duplicates).

**Payment protection**: payment can only start when the order is `PENDING_PAYMENT` (Paystack, saved card), and a bank transfer is only requested after acceptance (its payment stays `PENDING` until then). Acceptance checks the offered version number and expiry inside a transaction, so an old, replayed or expired price can't be accepted, and an accepted price can't be changed (offers are refused once the order left `AWAITING_DELIVERY_QUOTE`). If the store moves its pickup pin more than 200 m after the price was set, acceptance is stopped and the price goes back to the admin.

## Prices are fixed between DOORSTEP and its riders

Customers **don't negotiate**: they see one price and can only **Accept** (then pay) or **Decline** (order cancelled, nothing charged). Businesses aren't involved.

1. **Ask riders** (Admin › Prices to confirm › an order › *Agree the price with riders*): optional suggested rider pay and a note. Up to 20 approved DOORSTEP riders are alerted — online riders nearest the store first. They see the store, the drop-off area, landmark and distance; never the customer's name, phone or exact address.
2. **Riders answer** in *Rider › Price checks*: **OK at ₦X** (the suggestion), **Suggest another price** (with a reason) or **Not for me**. They can change their answer while the check is open (48 hours, or until the customer has a price).
3. **The admin chooses** — tap **Use** on a rider's answer or type the rider pay — then sets the customer price. The form shows what DOORSTEP keeps (and warns when it's a loss). A rider's pay can't be set below the price they agreed.
4. When the customer accepts, the **rider pay is fixed on the order** (no "needs a price" after delivery), and the rider who agreed is **offered the job first** if they're online and near the store.

API: `POST /api/admin/delivery-quotes/:id/ask-riders` `{ suggestedPayMinor?, note? }`, `GET /api/admin/delivery-quotes/:id/rider-prices`, `GET /api/rider/price-checks`, `POST /api/rider/price-checks/:id` `{ response: AGREE|COUNTER|DECLINE, amountMinor?, note? }`; the offer takes `riderPayMinor` and `agreedRiderId`. Migration `20261109140000_rider_price_checks` (additive).

## Screens

- **Checkout**: "Delivery: To be confirmed", the message from the brief, optional directions for the rider, and the button "Send order for a delivery price" (no payment).
- **Orders › order**: the price card — amount, reason, new total, sent date, valid-until, **Accept**, **Decline**, and the price history. After accepting, the usual **Pay now** appears.
- **Admin › Prices to confirm** (`/admin/delivery-quotes`): 30-day overview (orders, automatic vs manual, waiting for you / customers, acceptance rate, average fee, fees collected, corrections), tabs, search, pages; each request shows customer, phone, address, landmark, directions, map pin, store, Google Maps route link, distance record, estimate, the customer's review message, the price form (price / special agreed price / free delivery, message, validity, distance correction, private note), **Keep the price**, **Can't deliver**, and the full history. Also on the admin to-do list.
- **Admin › Delivery prices**: fixed price and "remote" per area (no map pin needed), remote and weekend surcharges, free-delivery threshold, precedence, manual-price settings.
- **Store Kit › Live orders**: "N orders waiting for a delivery price" (don't prepare yet); businesses are notified when a price is confirmed and receive the order once paid.

Notifications (in-app + phone push through the existing system): customer — location needs review, price ready, revised price, expired, confirmed/payment can proceed, cancelled; admins — new request, review requested, declined, expired, store moved; business — price confirmed.

## API

Customer: `GET /api/orders/:id/delivery-quote`, `POST /api/orders/:id/delivery-quote/respond` `{ action: ACCEPT|DECLINE, version }`.
Business: `GET /api/restaurant/delivery-quotes`.
Admin: `GET /api/admin/delivery-quotes?tab=todo|customer|done|all&q=&page=`, `GET /api/admin/delivery-quotes/:id`, `POST …/:id/offer` `{ feeMinor, pricingMethod, explanation?, internalNote?, expiresInHours?, correctedDistanceKm?, correctionReason? }`, `POST …/:id/keep` `{ message }`, `POST …/:id/cancel` `{ reason }`, `GET /api/admin/delivery-quotes-summary?days=30`.
Existing: `POST /api/orders/validate` now returns `deliveryQuoteRequired`; `POST /api/orders` accepts `deliveryInstructions`.

## Database (migration `20261109100000_delivery_quotations`, additive only)

- `OrderStatus` gains `AWAITING_DELIVERY_QUOTE`.
- `Order` gains `deliveryPricingMethod`, `distanceStatus`, `locationConfidence` (nullable).
- New tables `DeliveryQuotation`, `DeliveryQuotationVersion`, `DeliveryQuotationEvent`.
- Pricing settings (JSON in `PlatformSetting`) gain `surcharges`, `freeDelivery`, `precedence`, `manualQuotes`, and per-area `fixedFeeMinor` / `remote`, all with defaults, so saved settings keep loading unchanged.

Money is stored in kobo integers (no floating point).

## Known limits

- A promo code's discount is worked out when the order is placed. For orders waiting for a price the delivery fee is ₦0 at that moment, so a free-delivery promo doesn't reduce the later agreed fee (the admin can choose "Free delivery" when sending the price instead).
- Road distance comes from Mapbox Directions (`MAPBOX_SERVER_TOKEN` on the server). Without it every distance is a straight-line estimate and, with the default settings, every delivery goes to a manual price.
- Only the `ADMIN` role exists, so every admin can send prices up to the configured maximum; there are no finer permission levels.

## Deploying on your ZimaOS server (Coolify)

1. **Back up the database first** (Coolify › your PostgreSQL › Backups › Backup now, or `pg_dump`).
2. Push the code to GitHub (VS Code: commit and push).
3. In Coolify, open the **API** application (built from `Dockerfile`) and press **Redeploy**. On start it runs `node server/migrate.js` (applies the migration above, then the location set-up) and then the server. Check the logs for `[database]` lines and no errors.
4. Check the API's environment variables in Coolify are still there: `DATABASE_URL`, `AUTH_SECRET`, `PAYSTACK_SECRET_KEY`, `MAPBOX_SERVER_TOKEN` (for road distances), `WEB_ORIGIN`/`WEB_ORIGINS`, `PAYMENT_CALLBACK_URL`. Never put them in the code.
5. Redeploy the **website** (`Dockerfile.web`, with `VITE_API_BASE_URL` pointing at your API's address), or `npm run build` + `npx wrangler deploy` if the site is still on Cloudflare.
6. Test: Admin › Delivery prices (the new cards load) → Admin › Prices to confirm (empty list) → place an order to an address with no pin → it appears in Prices to confirm → send a price → accept it as the customer → pay.

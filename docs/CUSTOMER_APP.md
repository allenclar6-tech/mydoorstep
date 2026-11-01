# DOORSTEP customer app (1 Nov 2026)

The customer side of mydoorstep.com.co is now a mobile-first app. Its layout was inspired by the big delivery apps, but every screen, name and graphic is DOORSTEP's own: the forest-green and gold palette, the "d" mark, and lucide icons. No third-party logos or illustrations are used.

## Screens

| Path | Screen |
|---|---|
| `/` | **Home** has these parts: <ul><li>an address pill;</li><li>search;</li><li>category tiles: Food, Groceries, Shops, Pharmacy & Beauty and Package Delivery;</li><li>a first-order banner;</li><li>an offers rail;</li><li>"These are for you", "Most in demand" and "New on DOORSTEP" rails;</li><li>an out-of-area screen.</li></ul> |
| `/food` (also `/restaurants`), `/groceries`, `/shops`, `/pharmacy` | **Section pages** have these parts: <ul><li>search;</li><li>sub-category chips;</li><li>filters: Sort by, Top rated, Pickup, Open now and Free delivery;</li><li>a "Popular right now" rail;</li><li>the store list.</li></ul> Sub-category chips cover Promotions, Local food, Rice & Jollof, Shawarma, Suya & Grills, Pizza and more. A chip appears only when at least one store matches it. |
| `/discover` | **Discover** has search across stores and items, plus four rails: Most in demand, Budget friendly, Top restaurants and Top performers. Add `?section=demand\|budget\|top\|performers` to see a full ranked list. |
| `/store/:slug` (also `/restaurants/:slug`, `/groceries/:slug`) | **Store page**. See [Store page](#store-page). |
| `/checkout` (also `/cart`) | **Checkout**. See [Checkout](#checkout). |
| `/profile` | **Profile**. See [Profile](#profile). |
| `/account/promos` | **Promo codes**: the codes this customer can still use, with the reason for any code that no longer works. |
| `/help/faq` | **FAQ**. |

### Store page

- Delivery/Pickup toggle.
- Rating % with a reviews sheet.
- ETA, and the fee ("Free" with the old amount struck through when a free-delivery offer applies).
- Closed-store banner.
- Menu search and section tabs.
- Top sellers, computed from real orders in the last 60 days.
- Item sheet with a note for the store and a quantity.
- Favourite and share buttons.
- "Fees information" sheet.

### Checkout

- Basket editing.
- Delivery or Pickup.
- Address sheet or the store's address with directions.
- Landmark and phone.
- **Standard or Schedule**: 30-minute slots inside the store's hours, 45 minutes to 7 days ahead.
- Payment method: Paystack card/bank/USSD, saved cards, or bank transfer.
- **Promo code**.
- **Rider tip**: ₦0/200/300/500 or another amount, with "Save tip for next orders".
- Summary of Products, Delivery, Services, Tip, Promo and Total.

### Profile

- Account and order history.
- Addresses, payments, promo codes, favourites and notifications.
- Language: English for now, stated honestly.
- Appearance: light, dark, or same as the phone.
- FAQ and support.
- "DOORSTEP Plus — coming soon".
- Delete my account and data. This sends a support ticket; it does not delete anything instantly.
- Log out.

Partner, rider and admin screens are unchanged except for the additions below.

## Features with server support

### Pickup orders

The pickup order lifecycle:
1. When ordering, the customer chooses **Pickup**.
2. No delivery fee, no rider and no tip.
3. The lower own-rider commission rate applies, because no DOORSTEP rider is involved.
4. The business marks the order **Ready**.
5. The customer is told "ready to collect".
6. The business taps **Customer collected it**, and the order becomes `DELIVERED`.

Businesses can switch pickup off at the top of their Orders page. Admins can switch it off per store in **Admin › Promo codes › Store sections**.

### Scheduled orders

- `Order.scheduledFor` holds the requested time.
- The store must be open at that time (not necessarily now).
- Riders are offered the delivery about **35 minutes before** the chosen time, and open jobs hide it until then.
- The business board shows "Deliver Tomorrow, 7:30 pm".

### Rider tips

- `Order.tipMinor` is charged with the order.
- When the delivery completes, a `TIP` ledger line credits **100% to the rider**, with no DOORSTEP fee.
- If the business's own rider delivered, the line goes to the business, to pass on to its rider.

### Promo codes and automatic offers

Admins manage promotions in **Admin › Promo codes**. Each promotion has:
- a type: % off items (with a cap), ₦ off, or free delivery;
- a minimum basket;
- dates;
- a per-customer limit and a total uses limit;
- "first order only";
- "apply automatically (no code needed)";
- an optional section or store.

To set up the welcome offer, use **Set up first-order free delivery**.

Promotion rules:
- DOORSTEP pays every discount out of its own part of the order: commission, service fee and the delivery fee it keeps. The business is always paid its full share, and the Paystack split stays valid.
- A discount bigger than DOORSTEP's part is capped automatically.
- A `PROMO_DISCOUNT` ledger line records the cost.
- Usage counts paid orders, and unpaid orders for 2 hours. Cancelled or abandoned orders give the code back.

### Store sections

- `Restaurant.vertical` is one of `FOOD`, `GROCERIES`, `SHOPS` or `PHARMACY_BEAUTY`.
- The migration fills it in for existing stores: restaurants become Food; grocery applications marked pharmacy/beauty become Pharmacy & Beauty; specialty, electronics, fashion, phones and general shops become Shops; the rest become Groceries.
- The store application form now offers Beauty, Phones, Electronics, Fashion and General shop.
- Admins can move a store between sections.

### Deliverability

`POST /api/delivery/check` drives the red address pill and the "Out of delivery area" screen. An address is outside the delivery area when any of these is true:
- it is more than 25 km from Sapele;
- it is in a paused zone;
- it is outside the approved zones, when the "Only approved zones" switch is on in Delivery pricing.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/app/home` | Stores with real 30-day order counts, the Discover rankings, live offers and first-order eligibility. Sign-in is optional. |
| GET | `/api/app/stores/:slug` | Store, top-seller item IDs and moderated reviews. |
| POST | `/api/delivery/check` | Takes `{latitude, longitude, addressLine}` and returns `{deliverable, reason, message, zone}`. |
| GET | `/api/promos/available` | The customer's usable offers. |
| POST | `/api/account/deletion-request` | Opens an `ACCOUNT_DELETION` support ticket and alerts admins. |
| GET/PATCH | `/api/restaurant/store-options` | The business's pickup switch. |
| GET/POST/PUT | `/api/admin/promos[/:id]` | Promo management. |
| PATCH | `/api/admin/promos/:id/active` | Switches a promo on or off. |
| PATCH | `/api/admin/restaurants/:id/store-section` | Sets a store's section and pickup. |
| POST | `/api/orders/validate`, `/api/orders` | Now accept `orderType`, `scheduledFor`, `tipMinor` and `promoCode`. The quote returns `tipMinor`, `discountMinor`, `promotion` and `promoProblem`. |

## Code

- `server/promotions.js`: promo, tip and schedule rules (pure).
- `server/customerApp.js`: deliverability and rankings (pure).
- `server/customerAppRoutes.js`: the routes above.
- `src/shop/*`: the screens. `shopData.js` holds data, cart and address state. `ShopKit.jsx` holds the shared components. `shop.css` holds the styles, including dark mode.
- `src/admin/PromosAdmin.jsx` and `src/live/PickupToggle.jsx`.
- Tests: `tests/customerApp.test.js` (7 tests). It covers:
  - the promo rules, and the discount cap that protects the business share;
  - automatic offers;
  - tips;
  - pickup commission;
  - schedule limits;
  - deliverability;
  - the rankings.
- Migration: `20261101100000_customer_app`. It only adds columns, a foreign key and an index; it deletes nothing.

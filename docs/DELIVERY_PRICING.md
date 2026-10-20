# Sapele delivery pricing

Admin → **Delivery pricing** (`/admin/pricing`) is where DOORSTEP balances three things:
- what customers pay for delivery;
- what riders earn;
- what DOORSTEP keeps.

The model is Glovo-style. The customer pays a delivery fee that grows with road distance, and the rider is paid from DOORSTEP's own rate card. DOORSTEP keeps the difference, plus its commission and the service fee.

## Why prices were wrong before

- Checkout always charged a flat ₦800, wherever the customer was.
- Riders were shown that ₦800 customer fee as if it were their pay.
- Picking an area such as "Amukpe" saved no map point, so no distance could be measured.
- A road route was trusted blindly, even when a pin had snapped to the wrong road and the route made a huge detour.

## How a delivery is priced now (after you press Publish)

**1. Where the trip starts and ends**

The start is the business's map pin. The end, in order of preference:
- the customer's exact pin;
- their saved address pin;
- the centre of the Sapele area they chose.

If a pin is missing, the order is priced on an assumed distance (4 km by default) and the rider's pay is marked for an admin to check.

**2. Distance**

The distance is the shortest road route from Mapbox (up to three alternatives). Guards stop bad prices:
- **No route, or Mapbox is down:** the distance is the straight line × 1.35, and the trip is marked "estimated". Checkout never fails because of routing.
- **Route shorter than the straight line:** this is impossible and means a pin is wrong, so the distance is estimated instead.
- **Route longer than 2.8 × the straight line:** the distance is capped and flagged. If a trip really needs the detour (a river crossing or a closed road), add an agreed price for it.
- **Trips beyond the maximum distance** (15 km by default) are refused at checkout with a clear message.

**3. Customer fee**

The fee is the base fee (covering the first 2 km) plus a charge per extra km, clamped to the minimum and maximum. Then:
- any area surcharge is added;
- the busy-time boost is added when it's switched on;
- the result is rounded up to ₦50.

**4. Rider pay**

The rider earns the distance band from the rate card, plus any area bonus and the busy-time boost.

**5. Agreed prices**

An agreed price between two areas replaces the formula for the customer fee, the rider amount, or both. Use it for prices negotiated with riders. It can apply in both directions.

**6. Margin protection**

When this is on, the customer fee is raised just enough to cover the rider's pay plus your minimum margin (₦100 by default). Agreed prices are never raised; if one loses money, it is flagged instead.

**7. Money flow**

- **Commission:** DOORSTEP takes 15% of the food when DOORSTEP provides the rider, and 10% when the business uses its own rider.
- **Business-owned riders:** the business keeps the delivery fee.
- **Service fee:** a percentage of the food, with a minimum and a maximum.

**What is stored on each order**

Every order keeps the price breakdown, including the rider's pay, in `Order.deliveryQuote` and `Order.plannedRiderPayMinor`. Changing rates later never changes past orders.

**What customers and riders see**

- **Customers:** checkout shows the fee and the distance from the server. They never see rider pay or DOORSTEP's margin.
- **Riders:** the available-jobs list shows "You earn ₦X · Y km" before they accept.

## Sapele address directory

`server/sapeleDirectory.js` holds 47 groups with 203 streets/roads, 150 quarters/villages, 7 estates/layouts and 158 landmarks (schools, churches, markets, hospitals, hotels, junctions, banks, public offices). It started from your spreadsheet and was expanded from public listings. The full table, with a source on every row, is `docs/data/Sapele_LGA_Master_Directory_DOORSTEP_expanded.xlsx`. Your original is kept next to it.

The sources are:
- INEC polling units, which name schools, junctions and quarters in every ward;
- zipcodes.ng, for streets by postcode;
- the OpenStreetMap street index (openalfa);
- BEDC feeder areas in NERC orders;
- bookhotels.ng, finelib.com, the NHIA facility list, the FRSC list, the Access Bank branch list and infoisinfo.ng;
- Delta Mirror, Naij News Alert, jiji.ng and discoverdeltang.com.

What it changes:
- **Customer suggestions:** address fields suggest streets, quarters, estates and landmarks as people type. For example, "mona" gives "Mona School · School · Agimele Village district".
- **Pricing areas:** the 36 plannable areas (postcode districts, neighbourhoods, rural groups) are the Sapele pricing areas.
- **Places with no confirmed district:** these sit under their INEC ward (Sapele Urban I–VIII, Amuokpe) or "Sapele town". They are searchable but never decide a delivery price.
- **Ambiguous streets:** a street listed in two districts is not guessed.

It has no coordinates and is not an official register. Check spellings and districts locally. When you confirm a ward item's district, move it into that area.

## Starter values (edit before publishing)

These are suggestions only. There is no official Sapele rider tariff.

| Setting | Starter value |
|---|---|
| Customer base fee | ₦700, covering the first 2 km |
| Each extra km | ₦150 |
| Minimum / maximum fee | ₦700 / ₦3,500 |
| Service fee | 3% (maximum ₦1,000) |
| Rider bands (via "Fill starter suggestion") | ₦500 up to 2 km, ₦700 up to 4 km, ₦900 up to 6 km, ₦1,100 up to 8 km, then ₦120 per km |
| Margin protection | on, minimum ₦100 |

## To go live

1. Set `MAPBOX_SERVER_TOKEN` on Render, so distances come from real roads rather than estimates.
2. In **Sapele areas**, place each area's centre on the map. Areas start unplaced; no coordinates are guessed.
3. Ask every business to set its location (Earnings → Pickup point). The Areas tab lists businesses that have no pin.
4. In **Fees & rider rates**, enter your rates and switch the rider rate card on.
5. Use the **Calculator** to try real trips, and check that the **Balance check** table has no red margins.
6. Press **Publish**. Unpublishing returns checkout to the flat ₦800 fee and 3% service fee straight away.

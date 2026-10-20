# Live delivery handling

## Order flow
1. **Customer pays.** The order appears under **New** on the business's Orders page. The phone vibrates and the page refreshes by itself every 12 seconds.
2. **Business accepts or declines.**
   - **Decline:** the business picks a reason. The customer gets a Paystack refund straight away; bank transfers go to an admin to refund.
   - **Accept:** the order goes to the rider-matching step below. *Start preparing* and *Ready for pickup* then move it along. *Ready* tells the assigned rider the food is waiting.
3. **Auto-dispatch** (`server/dispatch.js`):
   - **Who is chosen:** the nearest free online rider. "Nearest" uses the location riders share when they go online or their latest live ping, up to 30 minutes old and within 10 km. Riders with no recent location come after those with one. Ties go to whoever has been online longest.
   - **The offer:** it reaches only that rider, as "You earn ₦X · 3.2 km trip", with **45 seconds** to accept.
   - **Pass or no answer:** the next rider gets it. Riders who passed are skipped for 3 minutes.
   - **Own riders:** businesses set to use their own riders offer to them first, then the DOORSTEP pool.
   - **Nobody free:** the order stays in the open "Available" list every online rider can see. It is retried every 10 seconds and whenever a rider goes online. Admins get one alert after 10 minutes.
4. **Rider's stages:** head to the store, *I'm at the store*, *Order picked up*, *Head to the customer*, then **Delivered**.
5. **Proof of delivery.** The customer's order page shows a 4-digit **delivery code**, and the rider must enter it to finish.
   - The code is derived from the delivery id with a server secret, so it is never stored or sent to riders or businesses.
   - After 5 wrong codes the delivery locks. Support can then use *Confirm delivered* in Admin › Active deliveries, with a note, and the action is recorded in the audit log.
6. **Customer view.** The order page shows an arrival estimate ("24 min · arriving around 6:01 pm"), "Finding the nearest rider…", the rider's name with a call button, and the code. The estimate waits for either the food or the rider (whichever is later), then adds the ride (straight line × 1.35 at 18 km/h) plus 3 minutes for the handover. It is labelled "estimate" until there is a live rider location.

## Admin
Admin › Active deliveries starts with **Waiting for a rider**. It shows:
- every accepted order without a rider, with how long it has waited;
- how many riders were offered it, passed or didn't answer;
- an **Offer again** button.

## Settings
- `DISPATCH_SWEEP=off` stops the background loop, for example while debugging.
- `DELIVERY_CODE_SECRET` is optional. Without it, a secret is generated once and kept in the database.
- The timings are constants at the top of `server/dispatch.js`: `OFFER_SECONDS`, `MAX_DISPATCH_KM` and `STUCK_AFTER_MS`.

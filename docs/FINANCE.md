# DOORSTEP money flows

## Who pays whom

1. **Customer → DOORSTEP.** Every card payment goes through DOORSTEP's Paystack account.
2. **Business share.** When a restaurant or grocery store has added a verified payout account, the payment is split automatically by Paystack.
   - The business's share goes to its own bank through a Paystack subaccount.
   - DOORSTEP keeps the rest.
   - If the business has no account yet, or the order was paid by bank transfer or a saved card, its share is recorded as **owed** and paid out from Admin → Money.
3. **DOORSTEP keeps:**
   - the commission;
   - the service fee;
   - the delivery fee, when a DOORSTEP rider delivers.
4. **Riders.** Each completed delivery records the rider's earning from the Sapele distance rate table, using road distance from pickup to drop-off. Riders are paid from Admin → Money, either by Paystack Transfer or as a recorded bank payment.
5. **Business-owned riders** are paid by their business. DOORSTEP doesn't record an earning for them.

## Commission (Admin → Money → Commission & rider pay)

Commission is a percentage of the **item subtotal only**:

| Who delivers | Commission | Delivery fee goes to |
|---|---|---|
| DOORSTEP rider | 15% | DOORSTEP (it pays the rider) |
| The business's own rider | 10% | The business (it pays its rider) |

- **How the rate is chosen:** an order follows the business's delivery preference ("own riders" means 10%). A business that does both is planned at 15%.
- **When the plan changes:** if the business's own rider actually delivers an order planned at 15%, the business is credited the difference (5% plus the delivery fee) as an adjustment. The reverse is debited from its future earnings.
- **Rate changes:** the rates are stored on each order when it's placed, so changing them later never rewrites past orders.

## Sapele rider rates

No official published Sapele payout rate could be found, so none is built in.
- Enter your rate per distance band in Admin → Money, plus an optional charge per extra km, and switch it on.
- Until then, completed deliveries appear as **"Needs a price"** for an admin to set.
- The same happens when a delivery's distance is unknown (for example, the business hasn't set its pickup point). Businesses set this under Earnings → Pickup point.

## Setup

1. **Saved payout accounts.** Businesses and riders open **Earnings → Add bank account**.
   - Paystack confirms the account name.
   - Changing the account needs their password and notifies them and the admins.
2. **Paystack split.** Works with the existing Paystack keys and needs nothing extra. Who pays Paystack's fee is set in Admin → Money (DOORSTEP by default).
3. **Paystack Transfers (optional, for one-tap payouts):**
   1. Enable Transfers in the Paystack dashboard.
   2. Fund the balance.
   3. Optionally turn off transfer OTP under Settings → Preferences.
   4. Set `PAYSTACK_TRANSFERS_ENABLED=true` on the Render API service.
   5. Add the transfer events (`transfer.success`, `transfer.failed`, `transfer.reversed`) to the existing webhook URL `https://mydoorstep-api.onrender.com/api/payments/webhook`.
4. **Database.** Migration `20261020110000_finance_ledger` is additive. Earlier orders keep their recorded commission. New ledger rows start with new payments.

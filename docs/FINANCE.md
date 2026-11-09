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
   - **DOORSTEP's rider fee:** DOORSTEP keeps a percentage of each delivery earning (set in Admin → Money → Commission & rider pay).
     - **Private between DOORSTEP and riders.** Only admins and riders can see the rate and the rider rate card. Businesses and customers never get it from any screen or API: business order lists drop rider pay and DOORSTEP's delivery margin, and a business's Earnings page only shows its own commission.
     - The rider's statement shows the full earning and the fee as separate lines.
     - The fee clears together with its earning, and counts as DOORSTEP income.
     - A rate change applies to deliveries completed afterwards.
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

The rate card can also be edited, together with customer delivery fees, in **Admin → Delivery pricing** (see [DELIVERY_PRICING.md](DELIVERY_PRICING.md)). Once delivery pricing is published, each order stores the rider's pay at checkout and that amount is what the rider is paid.

## Payouts (Admin → Money → Payouts)

Set separately for businesses and for riders:

| Mode | What happens |
|---|---|
| **Automatic** | Money is sent as soon as it clears and the balance reaches the minimum. The server checks every minute. |
| **Scheduled** | Everything cleared is sent daily or weekly at a set time, Lagos time (Glovo-style weekly payouts). A run missed during a deploy happens as soon as the server is back. |
| **Manual** (default) | Nothing moves until an admin pays from "To pay out", by Paystack Transfer or as a recorded bank payment. |

- **When money clears:**
  - Order money clears once the order is **delivered** and the hold (default 24 hours for businesses) has passed. Customers get time to complain before money leaves.
  - Rider and package earnings clear after the rider hold (default none).
  - Deductions apply at once. Admin credits clear immediately.
- **Every payment method is treated the same.** Card orders without a split, saved-card orders and bank-transfer orders (once an admin confirms the money arrived) all credit the business's balance with the same commission percentage. They are then paid by the rules above. Card orders with a Paystack split still settle straight to the business.
- **Cash out now:** when switched on, a business or rider can withdraw its cleared balance any time from Earnings.
  - The fee is a flat amount plus an optional percentage, and is DOORSTEP income.
  - A minimum amount and a daily limit apply.
  - If the transfer fails, the fee is not charged and the money returns to the balance.
- **Withdraw button everywhere:** every business, grocery and rider screen has a **Withdraw** button in the header showing the ready balance, plus a balance banner on the dashboard. Both open the withdrawal sheet.
- **Withdrawal requests:** partners can always ask for their money. If "Cash out now" and Paystack Transfers are both on, it is sent instantly. Otherwise the **Withdraw** button creates a **withdrawal request**:
  - The exact cleared ledger lines are set aside at once (status `REQUESTED`), so the same money can't be withdrawn twice. The partner can cancel until it's sent.
  - Admins are notified and see it under **Admin → Money → Withdrawal requests**, with the full account number from Paystack, copy buttons and the exact amount.
  - The admin either taps **Send by Paystack** (once Transfers are on), taps **I paid it from my bank** (then enters the bank reference and an optional receipt), or taps **Decline** with a reason (the money returns to the balance, with no fee).
  - A bank payment then waits for the partner's "I received it", like any manual payout.
- **Fund a partner** (Admin → Money): add or deduct money on a business's or rider's balance. The admin sees the balance before and after, confirms once, and can undo straight away (undo posts a reversal). The partner is notified with the reason and can withdraw it.
- **Payout readiness** (top of Admin → Money): a checklist with the live Paystack balance. It shows whether partners can be paid straight to their bank and what's missing (Transfers flag, low balance, partners without bank accounts, payout mode).
- **Pay everyone now** sends every cleared balance in one go.
- **Credit or debit a balance:** for refunds a business covered, bonuses or penalties. The payee sees the reason.
- **Commission per business:** negotiated rates for one business, used for new orders only. Empty fields use the standard rates.
- **Safety:**
  - Every payout reserves the exact ledger rows it pays in one transaction, so no naira can be paid twice.
  - After an automatic transfer fails, that payee is left alone for 6 hours and admins are notified.
  - Set `PAYOUT_SWEEP=off` on Render to stop the automatic/scheduled loop without changing settings.

## Setup

1. **Saved payout accounts.** Businesses and riders open **Earnings → Add bank account**.
   - Paystack confirms the account name.
   - Changing the account needs their password and notifies them and the admins.
2. **Paystack split.** Works with the existing Paystack keys and needs nothing extra. Who pays Paystack's fee is set in Admin → Money (DOORSTEP by default).
3. **Paystack Transfers (needed for automatic, scheduled, "Pay everyone" and cash-out payouts):**
   1. Enable Transfers in the Paystack dashboard.
   2. Fund the balance.
   3. Optionally turn off transfer OTP under Settings → Preferences.
   4. Set `PAYSTACK_TRANSFERS_ENABLED=true` on the Render API service.
   5. Add the transfer events (`transfer.success`, `transfer.failed`, `transfer.reversed`) to the existing webhook URL `https://mydoorstep-api.onrender.com/api/payments/webhook`.
   6. Choose the payout modes in Admin → Money → Payouts. Everything stays manual until you do.
4. **Database.** Migrations `20261020110000_finance_ledger` and `20261022100000_payout_modes` are additive. Earlier orders keep their recorded commission. New ledger rows start with new payments.

## Books & statements (Admin › Money › Books & statements)

Built from the same ledger and payout records as Money & payouts. Nothing is stored twice, so the books always agree with what's owed.

- **Period:** this month, last month, last 7 days, this year, or any dates (Lagos days, up to about a year).
- **Summary:**
  - money in (successful customer payments);
  - DOORSTEP income by type (commission, delivery fees, service fees, rider fee, cash-out fees, parcels);
  - paid out (riders, businesses, and businesses paid automatically by Paystack split);
  - owed now (riders and businesses separately);
  - customer refunds still to pay, and rider earnings waiting for a price.
- **Who DOORSTEP owes:** **Riders** and **Businesses** on separate tabs. Each person shows:
  - their bank (or "no bank account yet");
  - unpaid jobs;
  - earned in the period, and paid in the period (with the last payout date);
  - **owed now**.
- **Statements:** open anyone for their statement. It shows:
  - the opening balance;
  - **one line per job**, with the earning, DOORSTEP's fee and the tip shown underneath;
  - cash-out fees, payouts (and how they were sent), and shares paid at checkout by Paystack split;
  - a running balance and the closing balance.

  The closing balance always equals what's owed now: tests check this, including month-to-month continuity. Work still waiting for a price is listed separately and not counted.
- **Downloads:** each statement as CSV (opens in Excel or Google Sheets), or print it. **Full journal (CSV)** is every ledger line and payout in the period, with names and order numbers, for an accountant. Text cells can't run as spreadsheet formulas. Every admin export is recorded in the Activity log.
- **Riders and businesses** see their own **Monthly statement** (last 6 months, with CSV download) at the bottom of Earnings.

API: `GET /api/admin/books/summary`, `GET /api/admin/books/payees/rider|business`, `GET /api/admin/books/statement/rider|business/:id[?format=csv]`, `GET /api/admin/books/journal.csv`, `GET /api/finance/statement[?format=csv]`. All of them take `?from=YYYY-MM-DD&to=YYYY-MM-DD`.

Payments are still made in **Money & payouts**. Books & statements is the record.

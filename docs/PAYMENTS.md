# DOORSTEP Payments

## Current design

1. The authenticated customer creates a pending order through the API.
2. The server calculates totals from current menu prices and stores integer minor units.
3. The server initializes Paystack using the stored payment reference and total.
4. Paystack sends a signed webhook.
5. The API verifies the HMAC signature and reconciles reference, amount, and `NGN` currency.
6. A transaction marks payment successful and confirms the order inside a database transaction.

## Production requirements

- Configure `PAYSTACK_SECRET_KEY` in the **API service** environment, never in Vite/browser variables. Use either an `sk_test_` key or an `sk_live_` key with the matching Paystack account mode; never mix modes.
- Set `PAYMENT_CALLBACK_URL` in the API host environment and configure the Paystack webhook to `https://<api-host>/api/payments/webhook`.
- In Render, open the `mydoorstep-api` service, add `PAYSTACK_SECRET_KEY` under Environment, save it, and redeploy the API. The `sync: false` entry in [render.yaml](../render.yaml) deliberately declares the required secret without storing it in source control.
- `PAYSTACK_PUBLIC_KEY` is not required for the server-redirect checkout and is not returned by the payment configuration endpoint.
- Direct Doorstep Bank Transfer is separately configured by an administrator in **Admin Dashboard → Finance**. It uses manual verification by default: an authorized administrator must reconcile a reliable bank record, enter its transaction identifier and note, and the action is audited.
- Automatic direct-bank-transfer verification remains unavailable until a supported, transaction-specific provider integration is implemented and configured. Enabling it without that integration is intentionally rejected.
- Disabling Bank Transfer hides it for new checkouts and rejects new orders, while pending transfers retain their server-side instruction snapshot and remain verifiable.
- Add provider verification/reconciliation jobs for abandoned or delayed payments.
- Add refund and chargeback workflows with idempotency and audit logging.
- Never trust frontend totals or a frontend payment-success signal.

The current adapter is Paystack-first. Additional providers should implement the same server-side contract rather than adding provider logic to React components.

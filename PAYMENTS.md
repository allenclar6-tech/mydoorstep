# DOORSTEP Payments

## Current design

1. The authenticated customer creates a pending order through the API.
2. The server calculates totals from current menu prices and stores integer minor units.
3. The server initializes Paystack using the stored payment reference and total.
4. Paystack sends a signed webhook.
5. The API verifies the HMAC signature and reconciles reference, amount, and `NGN` currency.
6. A transaction marks payment successful and confirms the order inside a database transaction.

## Production requirements

- Configure separate test and live provider credentials.
- Set `PAYMENT_CALLBACK_URL` and webhook configuration in the host environment.
- Add provider verification/reconciliation jobs for abandoned or delayed payments.
- Add refund and chargeback workflows with idempotency and audit logging.
- Never trust frontend totals or a frontend payment-success signal.

The current adapter is Paystack-first. Additional providers should implement the same server-side contract rather than adding provider logic to React components.

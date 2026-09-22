# DOORSTEP Domain Setup

The purchased domain for this deployment is `mydoorstep.com.co`.

When approved by the owner:

1. In Cloudflare, keep `mydoorstep.com.co` active in the account that owns the domain.
2. Deploy the Vite frontend as the Cloudflare asset Worker `mydoorstep-site-20260922` and attach `mydoorstep.com.co` as the custom domain.
3. Point the API to a separate Node-capable host and attach `api.mydoorstep.com.co` to that service.
3. Enable HTTPS, HSTS, redirect rules, and origin protection.
4. Set `WEB_ORIGIN=https://mydoorstep.com.co`, `NEXT_PUBLIC_APP_URL=https://mydoorstep.com.co`, `VITE_API_BASE_URL=https://api.mydoorstep.com.co`, and `PAYMENT_CALLBACK_URL=https://mydoorstep.com.co/payment/callback`.
5. Configure business email sender domains with SPF, DKIM, and DMARC.
6. Verify payment webhooks and health/readiness checks after DNS cutover.

The frontend is already deployed to Cloudflare. The API must be deployed separately before public authentication, checkout, admin data, and payments can work. A Render/Docker blueprint is included in `render.yaml`.

Do not enable live payments or production traffic until API health, readiness, database migration, webhook, and private storage checks pass.

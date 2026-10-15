# DOORSTEP Domain Setup

The purchased domain for this deployment is `mydoorstep.com.co`, and the public storefront is live.

## Current production routing

- Cloudflare Worker `mydoorstep-site-20260922` serves `https://mydoorstep.com.co` and proxies `/api/*` to `https://mydoorstep-api.onrender.com`.
- The Render API health and readiness endpoints pass, including the same-origin `https://mydoorstep.com.co/api/ready` route.
- `api.mydoorstep.com.co` is not required by current traffic; it remains an optional custom hostname and should not replace the working same-origin proxy until DNS and health checks are confirmed.

For future domain changes:

1. Keep `mydoorstep.com.co` active in the Cloudflare account that owns the domain.
2. Keep HTTPS redirects and HSTS enabled, and use Full (strict) mode when the configured origin supports a valid certificate.
3. Set `WEB_ORIGIN=https://mydoorstep.com.co`, `NEXT_PUBLIC_APP_URL=https://mydoorstep.com.co`, `VITE_API_BASE_URL=https://mydoorstep.com.co`, and `PAYMENT_CALLBACK_URL=https://mydoorstep.com.co/payment/callback` where applicable.
4. Configure business email sender domains with SPF, DKIM, and DMARC.
5. Verify payment webhooks and health/readiness checks after any DNS or routing change.

A Render/Docker blueprint is included in `render.yaml`.

Do not enable live payments or production traffic until API health, readiness, database migration, webhook, and private storage checks pass.

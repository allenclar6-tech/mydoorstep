# DOORSTEP Domain Setup

The purchased domain for this deployment is `mydoorstep.com.co`, and the public storefront is live.

## Current production routing (since 2026-11-08)

- `mydoorstep.com.co`, `www.mydoorstep.com.co` and `api.mydoorstep.com.co` are proxied CNAMEs to the Cloudflare Tunnel `doorstep-zimaos`, which ends at the web container on the ZimaOS server. Details: [ZIMAOS_DEPLOYMENT.md](ZIMAOS_DEPLOYMENT.md).
- `www` redirects to `https://mydoorstep.com.co`; Cloudflare *Always Use HTTPS* is on.
- The site calls `/api` on its own domain; `api.mydoorstep.com.co` serves the same API and is the Paystack webhook host (`https://api.mydoorstep.com.co/api/payments/webhook`).
- Keep the Resend DNS records (`send`, `rsend`, `resend._domainkey`) as they are.
- Previous routing (Cloudflare Worker `mydoorstep-site-20260922` proxying to Render) is detached and kept only as a fallback; see section 8 of the ZimaOS guide.

For future domain changes:

1. Keep `mydoorstep.com.co` active in the Cloudflare account that owns the domain.
2. Keep HTTPS redirects and HSTS enabled, and use Full (strict) mode when the configured origin supports a valid certificate.
3. Set `WEB_ORIGIN=https://mydoorstep.com.co`, `NEXT_PUBLIC_APP_URL=https://mydoorstep.com.co`, `VITE_API_BASE_URL=https://api.mydoorstep.com.co`, and `PAYMENT_CALLBACK_URL=https://mydoorstep.com.co/payment/callback` where applicable.
4. Configure business email sender domains with SPF, DKIM, and DMARC.
5. Verify payment webhooks and health/readiness checks after any DNS or routing change.

The ZimaOS Docker Compose stack is in `deploy/zimaos/`; `render.yaml` describes the old Render fallback.

Do not enable live payments or production traffic until API health, readiness, database migration, webhook, and private storage checks pass.

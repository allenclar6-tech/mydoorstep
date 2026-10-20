# Sign-in, verification and business checks — setup and status

This covers Google sign-in, phone/WhatsApp codes, email codes, rider and business verification, the
runtime map key, rider availability and profile completeness. Every external integration stays **hidden or
clearly "not available yet"** until its keys are set. Nothing is simulated.

## What each piece needs

| Feature | Works without new keys? | Needs (Render → `mydoorstep-api` → Environment) | Where the value comes from |
|---|---|---|---|
| Email + password sign-up, email codes, password reset | Yes, if `RESEND_API_KEY` + `VERIFICATION_FROM_EMAIL` are already set | — | Resend dashboard → API Keys; sender on a verified domain |
| Google sign-in (customers) | No — button hidden | `GOOGLE_CLIENT_ID` | Google Cloud Console (steps below) |
| SMS codes (sign-in, sign-up, phone verification) | No — option hidden | Termii: `TERMII_API_KEY`, `TERMII_BASE_URL`, `TERMII_SENDER_ID` (optionally `SMS_PROVIDER=termii`, `TERMII_CHANNEL=dnd`) **or** Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SMS_PROVIDER=twilio` | Termii / Twilio dashboards |
| WhatsApp codes | No — option hidden | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_AUTH_TEMPLATE` (optional `WHATSAPP_TEMPLATE_LANGUAGE`, `WHATSAPP_GRAPH_VERSION`) | Meta Business / WhatsApp Manager |
| CAC lookup and rider ID check | Admins review documents manually; automatic buttons hidden | `NINJA_SECRET_KEY` | ninja.ng dashboard |
| Business registered / non-registered statuses, rider resubmission, admin decisions | Yes | — | — |
| Map on the live site | Needs the public token once | `MAPBOX_PUBLIC_TOKEN` (the same `pk.` token as `VITE_MAP_PUBLIC_TOKEN`) | Mapbox account → Tokens |
| Rider online/offline switch, profile completeness | Yes | — | — |

Never paste secret keys into chat, code or GitHub. Enter them only in Render's Environment page.

## 1. Google sign-in

1. Open Google Cloud Console → **APIs & Services → OAuth consent screen**. Choose External, app name "DOORSTEP", support email, and logo optional. The scopes `openid`, `email` and `profile` are basic scopes and don't need Google's sensitive-scope review. Publish the app.
2. Go to **Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized JavaScript origins:** `https://mydoorstep.com.co`, `https://www.mydoorstep.com.co`, and for local testing `http://localhost:5173` and `http://localhost`.
   - No redirect URI is needed. The site uses Google's popup button, and the API verifies the ID token itself.
3. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) into Render as `GOOGLE_CLIENT_ID`. No client secret is used.

How it's protected:
- The server checks Google's signature against `https://www.googleapis.com/oauth2/v3/certs`, plus `aud`, `iss` and expiry.
- Accounts are linked on Google's `sub`, never on the email.
- A Google sign-in joins an existing account automatically only when DOORSTEP has already verified that email **and** Google is authoritative for it (an `@gmail.com` address, or a Workspace domain). Otherwise the person signs in with their password and connects Google under **Account → Sign-in & security**.
- Google can't be used to enter partner, rider or admin accounts.

## 2. SMS codes (Termii recommended for Nigeria)

1. Create a Termii account and fund the wallet.
2. Under **Sender ID**, request an alphanumeric sender (for example `DOORSTEP`) for transactional OTP use and wait for approval.
3. From the dashboard, copy the **API key** and your account's **base URL**.
4. Set these in Render:
   - `TERMII_API_KEY`
   - `TERMII_BASE_URL` (your account's base URL, for example `https://v3.api.termii.com`)
   - `TERMII_SENDER_ID`
   - `TERMII_CHANNEL=dnd` (the DND route reaches numbers on Do-Not-Disturb)
   - `SMS_PROVIDER=termii`

DOORSTEP generates and checks the codes itself:
- six digits, valid for 10 minutes;
- 5 wrong tries lock the code;
- one new code per minute, 5 per hour per number;
- only a SHA-256 hash is stored, and codes are never logged.

Twilio remains available as an alternative. Check the current Nigeria sender-ID rules in the Twilio console before choosing it.

## 3. WhatsApp codes (Meta WhatsApp Cloud API)

1. Meta Business Suite → **Business settings → Business info**: complete **business verification**.
2. In WhatsApp Manager, add and verify the phone number DOORSTEP will send from, then note its **Phone number ID**.
3. **Message templates → Create → Authentication**:
   - choose **Copy code**;
   - turn on the security recommendation and a code expiry (10 minutes);
   - name it, for example, `doorstep_code`, in English (`en_US`);
   - wait for approval.
4. Create a **System user** with a **permanent access token** that has `whatsapp_business_messaging`.
5. Set these in Render:
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_AUTH_TEMPLATE=doorstep_code`

Meta charges per delivered authentication message. Check the current Nigeria rate on Meta's pricing page: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

## 4. Registry checks (Ninja)

Why Ninja: it publishes Naira prices with no minimum spend and offers free sandbox keys.
- CAC lookup: ₦550
- NIN / BVN match: ₦100
- Driver's licence, passport and voter's card match: ₦200

Smile ID and Dojah were also reviewed. Smile ID doesn't publish prices, and Dojah only quotes per-call ranges through sales. Smile ID also supports CAC certificates and NIN.

1. Sign up at ninja.ng. Sandbox keys (`sk_sandbox_…`) are issued straight away and are free.
2. Ninja verifies DOORSTEP itself (KYB) before issuing **live** keys (`sk_…`). Fund the prepaid wallet.
3. Set `NINJA_SECRET_KEY` in Render. The API picks the sandbox or live address from the key prefix.

What it does:
- Admins click **Look up on CAC register** (registered businesses) or **Check ID against records** (riders who gave consent).
- The result is advice only. A business becomes **Registered business verified** only after an admin decides, with either a matching CAC lookup or a certificate they opened and confirmed.
- Only the verdict and a minimal summary are stored: registered name, registry status, and a director count with no names. For riders, only the score, the recommendation and which fields mismatched are stored.

## 5. Map on the live site

The live site was built without the public Mapbox token, which is why it showed "missing public Mapbox token".

The site now asks the API for the token at runtime. Set `MAPBOX_PUBLIC_TOKEN` in Render to your `pk.` token. In the Mapbox account, restrict that token to these URLs:
- `https://mydoorstep.com.co`
- `https://www.mydoorstep.com.co`

## Business and rider verification rules

- **Customers** are never asked for ID.
- **Registered businesses** give their RC/BN number and CAC certificate. Their status goes Pending review → Registered business verified, Action required, or Rejected, with a note the business sees.
- **Non-registered businesses** apply without any certificate. They're shown as "Non-registered business", can still be approved to sell, and can add registration later.
- **Riders** can't be approved without an ID document on file or a matching ID check, and can't take jobs until approved.
- **Applicants** who are asked for more information upload it from their application status page, which re-opens the review and notifies admins.
- **Records:** every decision is written to the audit log. Documents stay on the private Render disk and are downloadable only by admins.

## Data protection (NDPA 2023 / NDPC GAID 2025)

Points to act on, which aren't legal advice:
- Riders now give explicit consent before an automatic ID check, and the consent time is recorded.
- Keep a written retention rule, for example: delete rejected applicants' documents after 12 months, and approved riders' documents 12 months after they leave.
- Appoint a DPO.
- Carry out a DPIA before running ID checks at scale.
- Check whether DOORSTEP must register with the NDPC as a data controller of major importance; this depends on how many people's data you hold.
- Update the privacy policy to name the verification partner (Ninja) and the messaging providers (Resend, Termii/Twilio, Meta).

## Database

Migration `20261020010000_auth_identities_business_verification` is additive:
- `passwordHash` becomes optional;
- adds the `AuthIdentity` and `VerificationCheck` tables;
- adds registration columns, `RiderApplication.identityCheckConsentAt` and `Rider.availabilityChangedAt`.

Existing applications with a registration number become "Registered · Pending review", and nothing is auto-verified.

Back up the Render database before deploying. The migration runs on start (`node server/migrate.js`).

# DOORSTEP Android: release, store submission and Google Search kit

Status on 3 November 2026: everything that can be done in the code is done. **No APK has been built yet**,
because building needs the Android SDK and your signing key, and those are only available on GitHub Actions or
your laptop. Nothing has been submitted to any store. Nothing in this file claims otherwise.

## 1. How the Android app works (approach)

DOORSTEP is a Vite/React website and installable web app (PWA), served by Cloudflare at **https://mydoorstep.com.co**.
Its API runs on Render (**https://mydoorstep-api.onrender.com**, reached through the website at `/api/…`).

The Android app is a **Trusted Web Activity (TWA)** built with Google's Bubblewrap tool. It is a real Android app,
with its own icon, name, splash screen, back button and notifications, that opens the live DOORSTEP website
full-screen. So:

- Sign-in, Paystack payments, live tracking, stores, partner and rider screens all work as they do on the site.
- No API keys or secrets are in the app. Paystack secret keys and database credentials stay on Render.
- The Android back button goes back through DOORSTEP's pages. With no internet, the app shows DOORSTEP's
  "You're offline" screen (`public/offline.html`).

I chose this over Capacitor because DOORSTEP is already a complete, working PWA. A TWA reuses it unchanged, can't fall
out of step with the website, and is accepted by Google Play.

| Setting | Value |
|---|---|
| App name | DOORSTEP |
| Package ID (permanent — never change it) | `co.com.mydoorstep.app` |
| First version | 1.0.0 (version code = the workflow run number) |
| Minimum Android | 7.0 (API 24) — required by Google's Android Browser Helper |
| Permissions | Internet; notifications (asked in the app); location only when the user taps "use my location" |
| Config | `android/twa-manifest.json` |
| Build | `docs/github-workflows/android-release.yml` (copy to `.github/workflows/`, see `android/README.md`) |

## 2. Build a release (every time)

One-time setup is in `android/README.md` (create the signing key on your laptop, add 3 GitHub secrets, copy
the workflow into `.github/workflows/`). Then for each release:

1. GitHub → **Actions** → **Android app** → **Run workflow**. Enter a new version (e.g. `1.0.0`, then `1.0.1`) and
   one line of release notes.
2. When it's green, the release `android-v1.0.0` holds `DOORSTEP-1.0.0.apk`, `DOORSTEP-1.0.0.aab` and the checksums.
   The workflow also updates `public/app-release.json` and `public/assetlinks.json` and commits them.
3. In VS Code: **Pull**, then deploy the website (`npx wrangler deploy`, as usual).

Or on your laptop instead of GitHub (needs Java 17 and Node 20):

```powershell
cd android
npx @bubblewrap/cli@1 build --manifest=./twa-manifest.json
```

### Download links (they never change)

- **https://mydoorstep.com.co/download** is the download page. It shows the version, size, date, Android
  version needed, the SHA-256 checksum, install steps, privacy, terms and support.
- **https://mydoorstep.com.co/downloads/doorstep.apk** always goes to the newest signed APK, using
  `public/app-release.json`. Until the first build it returns "not published yet" (404). It never points to a
  broken file.

Hosting: if the GitHub repository is public, the APK is served from GitHub Releases (free, fast, no size worries).
If it's private, the workflow copies the APK into `public/downloads/` and Cloudflare serves it. Cloudflare's limit
is 25 MB per file, and a TWA APK is about 1–3 MB. The APK is never stored in the database or on Render.

### Test before telling anyone (I could not do this from here)

On a real Android phone: download from `/download`, install, open. Check:

- [ ] no address bar shows (if one does, `/.well-known/assetlinks.json` isn't live: deploy the site);
- [ ] the yellow splash and DOORSTEP icon appear;
- [ ] you can sign in;
- [ ] you can browse stores and add to basket;
- [ ] a small real order is paid with Paystack;
- [ ] tracking opens;
- [ ] notifications arrive;
- [ ] the back button works;
- [ ] airplane mode shows the offline screen.

Also check the checksum on Windows: `Get-FileHash .\DOORSTEP-1.0.0.apk -Algorithm SHA256`.

## 3. Google's Android developer verification (important for 2027)

Google now requires apps installed on certified Android phones, **including direct downloads and other stores**,
to come from a verified developer with the app registered. It began on 30 September 2026 in Indonesia, Singapore
and Thailand and **extends globally in 2027**, so Nigeria is included then. Do this before 2027 or new installs may be
blocked:

1. Create an Android Developer Console / Google Play Console account. A full distribution account costs US$25 once,
   with ID verification.
2. Verify your identity and register the package `co.com.mydoorstep.app` with your signing key.

Source: [Understanding Android developer verification](https://support.google.com/android-developer-console/answer/16561738?hl=en)

## 4. Store listing text (same for every store)

- **Name:** DOORSTEP
- **Short description (≤ 80 chars):** Food, groceries & parcels delivered in Delta, Edo and Port Harcourt.
- **Full description:**

  DOORSTEP is the delivery app for Delta State, Edo State and Port Harcourt, Nigeria.

  • Food from local kitchens, bukas, cafés and bakeries
  • Groceries, shops, pharmacy and beauty, delivered to your door
  • Send a package across town: pick-up and drop-off, price shown before you pay
  • Track your rider live on the map until your order arrives
  • Type your address or drop a pin on the map
  • Pay securely by card (Paystack) or bank transfer. DOORSTEP never sees your card number.
  • Promo codes, free-delivery offers and one-tap reorder
  • Rate your order and read reviews from other customers

  Restaurants, shops and riders use the same app to take orders and deliveries.

- **Category:** Food & Drink · **Price:** Free · **Content rating:** Everyone · **Country:** Nigeria
- **Website:** https://mydoorstep.com.co · **Privacy:** https://mydoorstep.com.co/privacy · **Terms:** https://mydoorstep.com.co/terms
- **Support email:** support@mydoorstep.com.co. Make sure this mailbox exists and is read before listing.
- **Developer:** DOORSTEP, Sapele, Delta State, Nigeria. Add the registered company name and RC number in
  `src/legal/legalContent.js` once confirmed.
- **Icon:** `public/icons/icon-512.png` (512 × 512)
- **Screenshots:** 4–6 real screenshots from an installed phone: home, a store, basket/checkout, live tracking,
  send a package. I did not make any, because stores reject mock-ups and invented screens would mislead customers.
- **Release notes (1.0.0):** First Android release of DOORSTEP: order food, groceries and more, send packages and
  track your rider live.

## 5. APKPure: checklist (needs your account)

APKPure's submission page couldn't be loaded from here, so check its current rules when you open it.

- [ ] Open https://apkpure.net/submit-apk and sign in / create the developer account it asks for.
- [ ] Upload `DOORSTEP-x.y.z.apk` from the GitHub Release. Always upload the same signed file as on your website.
- [ ] Paste the listing from section 4; add the icon and real screenshots.
- [ ] If asked to prove you own the app, use the method offered. That's usually your signing key or the website
      domain, and `https://mydoorstep.com.co/.well-known/assetlinks.json` already lists the key's fingerprint.
- [ ] Wait for review. Only call it "published" once the listing page opens publicly.

## 6. Uptodown: checklist (needs your account)

Uptodown says registration and publishing are free. The steps are: sign up on the Developers Console, then
"Upload your app or claim its authorship".

- [ ] Sign up at https://en.uptodown.com/developers-console.
- [ ] Upload the APK (same signed file), or "claim authorship" if Uptodown already lists it.
- [ ] Paste the listing from section 4, the icon and real screenshots, and the privacy policy link.
- [ ] Wait for review and check the public listing before announcing it.

For new versions, upload the new APK in both consoles. Nothing here publishes to a store automatically, by design.

## 7. Google Play later (US$25 one-time, same account as section 3)

- Upload `DOORSTEP-x.y.z.aab` (not the APK) and turn on Play App Signing. Then add Play's SHA-256 fingerprint to
  `public/assetlinks.json` (keep yours too) and deploy, or the Play version shows an address bar.
- Target API: Play requires a recent target SDK. Bubblewrap 1.x targets a current level; rebuild with the latest
  Bubblewrap before uploading if Play warns you.
- New personal developer accounts must run a **closed test with at least 12 testers for 14 days** before going
  public. Check Play Console for the current rule.
- **Data safety form (draft, check it against `src/legal/legalContent.js`):**

  | Data | Collected | Why | Shared |
  |---|---|---|---|
  | Name, email, phone | Yes | Account, order updates | With the store and rider for your order |
  | Delivery addresses, map pin | Yes | Deliveries and fees | With the store and rider |
  | Precise location | Only when you choose to use it | Address pin; riders' live location during deliveries | Customer sees their rider's position |
  | Order history | Yes | Orders, receipts, support | No |
  | Payment info | Card details are handled by Paystack, not DOORSTEP | Payments | Paystack |
  | Photos (partners/riders) | Yes, when uploaded | Store menus, verification | No |

  Data is encrypted in transit (HTTPS) and you can delete your account (say how, as in the privacy policy).
  There are no ads, no advertising ID and no sale of data.

## 8. Google Search

Already in the code:

- The `/download` page has its own title and summary (written into the HTML by `worker.js`, so crawlers see them).
- Every page has a canonical address.
- `sitemap.xml` lists `/download`, `/privacy` and `/terms`, and `robots.txt` allows them (it only blocks
  admin and account pages).
- The site footer links "Get the app" to `/download`, and Profile has "Get the DOORSTEP app".
- App details for Google (version, size, free) are added only once a real APK exists. No fake ratings.

What you do (free):

1. https://search.google.com/search-console → **Add property** → *Domain* `mydoorstep.com.co`. Cloudflare can add
   the DNS TXT record for you, or add it in Cloudflare DNS.
2. **Sitemaps** → submit `https://mydoorstep.com.co/sitemap.xml`.
3. **URL inspection** → `https://mydoorstep.com.co/download` → *Test live URL* (this shows whether Google can
   crawl it) → *Request indexing*.
4. Optional: a Google Business Profile for DOORSTEP with the website and download link.

Google decides when and where pages appear. It usually takes days to weeks, and no ranking can be promised.
Google Search does not list APK files as app-store entries. It finds the DOORSTEP download page.

## 9. Website updates vs app updates

- **Website / live service changes** (new screens, prices, features): reach everyone as soon as you deploy, in the
  browser *and* in the Android app, because the app opens the live site. No reinstall.
- **Android app updates** (new icon, name, splash, notification settings, Android version requirements): need a new
  APK version. For people who installed from your website, the download page shows the new version and they install
  it over the old one. Their data is kept, as long as it's signed with the **same key**. Play, APKPure and
  Uptodown notify their own users once you upload the new version there.

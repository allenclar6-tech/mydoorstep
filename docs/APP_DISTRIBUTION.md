# Getting DOORSTEP onto phones — free distribution kit

How people get DOORSTEP today, and a ready-made kit for listing it on free app stores and getting found on Google.
Uploading to each store needs **your own account** on that store; nobody can do it for you without your sign-in.

## Ways to install (live now)

| Who | How | Cost |
|---|---|---|
| Android | **mydoorstep.com.co/download → Download for Android** (after the first APK is built — see `android/README.md`) | Free |
| Android, iPhone, computers | Install from the browser: the **Install** card (Android/computer) or **Share → Add to Home Screen** (iPhone) | Free |
| Admin | Open **mydoorstep.com.co/admin** and install **DOORSTEP Admin** (separate app with its own icon) | Free |

Print or share the QR code `public/download-qr.svg` (opens mydoorstep.com.co/download) on flyers, receipts,
stickers on delivery bags, shop counters and WhatsApp statuses.

## Before you list anywhere: the privacy policy

Every store asks for a **privacy policy link**, and DOORSTEP's `/privacy` and `/terms` pages are still **placeholders**.
Replace them with real text (what data DOORSTEP collects — name, phone, email, delivery addresses and location
during deliveries, order history; that card payments are handled by Paystack and DOORSTEP never sees card numbers;
how to delete an account; your contact email). Have it checked by someone who knows Nigerian data-protection rules
(NDPA 2023). Then use `https://mydoorstep.com.co/privacy` in every listing.

## Free Android app stores

All of them use the **same signed APK** from the GitHub Release (`DOORSTEP-x.y.z.apk`). Never upload a different
build — users would get "App not installed" when updating between stores.

| Store | Cost | Notes |
|---|---|---|
| **APKPure** | Free | Has a developer submission programme. Search "APKPure submit APK" or "APKPure developer". You'll verify you own the app (usually by signing with the same key). |
| **Uptodown** | Free | Has a developer programme for publishers. Search "Uptodown developers". |
| **Samsung Galaxy Store** | Free | Samsung seller account; reviewed before publishing. Pre-installed on Samsung phones — popular in Nigeria. |
| **Aptoide** | Free | Developer console; upload the APK. |
| **Huawei AppGallery** | Free | Huawei developer account. On Huawei phones without Google services the app opens through the phone's browser — test it first. |
| **Google Play** | US$25 once | Upload the `.aab` (not the APK). See the end of `android/README.md`. |

The Amazon Appstore stopped supporting Android phones in 2025, so it isn't listed.

## Store listing text (copy and paste)

**App name:** DOORSTEP — Food & Delivery in Nigeria

**Short description (≤ 80 characters):**
Order food, groceries & more in Delta, Edo and Rivers. Send packages. Track your rider live.

**Full description:**
DOORSTEP is the delivery app for Delta, Edo and Rivers States, Nigeria.

• Food from local kitchens, bukas, cafés and bakeries
• Groceries, shops, pharmacy and beauty — delivered to your door
• Send a package anywhere in your town: pick-up and drop-off, price shown before you pay
• Track your rider live on the map until your order arrives
• Type your address or drop a pin — the delivery fee is worked out by distance
• Pay securely by card (Paystack) or bank transfer; save your card for one-tap checkout
• Promo codes, free delivery offers and order-again in one tap
• Rate your order and read honest reviews from other customers

Restaurants and shops can sell on DOORSTEP, and riders can earn by delivering — sign in with your partner or rider
account in the same app.

**Category:** Food & Drink · **Content rating:** Everyone · **Price:** Free · **Country:** Nigeria
**Website:** https://mydoorstep.com.co · **Privacy policy:** https://mydoorstep.com.co/privacy
**Support email:** _your DOORSTEP support email_

**Icon:** `public/icons/icon-512.png` (512 × 512).
**Screenshots:** take 4–6 real screenshots on an Android phone after installing (home, a store page, checkout,
live tracking, send a package). Stores reject mock-ups that don't match the app.
**Feature graphic (Play/Galaxy):** 1024 × 500, DOORSTEP yellow `#FFC244` with the logo and "Delivered across Delta, Edo and Rivers".

## Getting found on Google

1. **Google Search Console** (free): add `mydoorstep.com.co` (Cloudflare can add the DNS check for you), then submit
   the sitemap `https://mydoorstep.com.co/sitemap.xml` and use *URL inspection → Request indexing* for
   `https://mydoorstep.com.co/download`. The download page already tells Google it's an app download page (once a
   real APK exists) — no fake ratings or reviews.
2. **Google Business Profile** (free): create "DOORSTEP" (delivery service, Delta, Edo and Rivers), add the website and the
   download link, photos, opening hours, and ask happy customers for reviews there.
3. Put the download link in your WhatsApp Business profile, Instagram/Facebook/TikTok bios, and on every receipt.
4. Ask partner restaurants and shops to display the QR code at their counters.

Results on Google take days to weeks; there's no instant way to get listed, and nobody can promise a ranking.

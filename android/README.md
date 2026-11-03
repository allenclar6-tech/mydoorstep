# DOORSTEP for Android — build and publish the APK (free)

DOORSTEP's Android app is a **Trusted Web Activity (TWA)**: Google's official way to ship a website as a real
Android app. It opens mydoorstep.com.co full-screen (no browser bar), with its own icon, a yellow opening screen,
notifications, and Paystack, maps and sign-in working exactly as on the website — because it *is* the website.
The same project later produces the `.aab` file Google Play needs.

| File | What it is |
|---|---|
| `android/twa-manifest.json` | App settings: name, package id `co.com.mydoorstep.app`, colours, icon, start page. |
| `.github/workflows/android-release.yml` | Builds, signs and publishes the app on GitHub (free). |
| `public/app-release.json` | Version, date, size, SHA-256 and link shown on mydoorstep.com.co/download. Written by the workflow. |
| `public/assetlinks.json` | Served at `/.well-known/assetlinks.json`; lets Android open the app without a browser bar. Written by the workflow. |

Nothing in this folder is secret except your signing key, which **never** goes into git (see `.gitignore`).

---

## One-time setup (about 15 minutes)

### 1. Create your signing key (on your laptop)

Android apps must be signed. The same key must sign **every** future version — if you lose it, phones can't update
the app, and you'd have to publish a new one. Back it up in two safe places (e.g. a USB stick and a password manager).

1. Install **Java 17** (free): search "Eclipse Temurin 17", download the Windows `.msi`, install it.
2. Open **PowerShell** in a folder **outside** the DOORSTEP project (for example `Documents\doorstep-keys`) and run:

   ```powershell
   keytool -genkeypair -v -keystore android.keystore -alias doorstep -keyalg RSA -keysize 2048 -validity 10000
   ```

   - Choose a strong password and write it down. When it asks for a key password, use the same one.
   - Name: `DOORSTEP`, Organisation: your business name, City: `Sapele`, Country code: `NG`.
   - The alias **must** be `doorstep` (the workflow expects it).

### 2. Give GitHub the key — as secrets, never as a file in the repo

1. In the same PowerShell window, copy the key as text:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\android.keystore")) | Set-Clipboard
   ```

2. On GitHub, open **allenclar6-tech/mydoorstep → Settings → Secrets and variables → Actions → New repository secret**, and add:

   | Name | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | paste (Ctrl+V) |
   | `ANDROID_KEYSTORE_PASSWORD` | your keystore password |
   | `ANDROID_KEY_PASSWORD` | your key password (same one if you used the same) |

3. Clear your clipboard afterwards (copy any other text).

### 3. Put the workflow in place, then push

GitHub only runs workflows stored in `.github\workflows\`. The workflow is saved in `docs\github-workflows\`, so copy
it across once — in the VS Code terminal, from the DOORSTEP folder:

```powershell
New-Item -ItemType Directory -Force .github\workflows | Out-Null
Copy-Item docs\github-workflows\android-release.yml .github\workflows\android-release.yml
```

Then commit and push from VS Code as usual (the workflow must be on GitHub before you can run it).

---

## Every release (about 5 minutes)

1. GitHub → **Actions** → **Android app** → **Run workflow**.
2. Choose the app — **doorstep** (customers, businesses, riders) or **admin** (DOORSTEP Admin, see
   `android-admin/README.md`) — type a **new** version for that app (e.g. `1.0.0`, then `1.0.1`…) and a one-line
   "what changed", then **Run**. Each app has its own versions; both use the same signing key and secrets.
3. Wait for the green tick (about 5–10 minutes). The run's **Summary** shows the SHA-256 and the download link.
   - It creates a **GitHub Release** `android-v1.0.0` with the `.apk`, the `.aab` (for Google Play) and a checksum file.
   - **Public repo:** the APK downloads straight from GitHub (the workflow checks the link works before using it).
   - **Private repo:** files on a private repo's releases can't be downloaded by the public, so the workflow also puts
     the APK in `public/downloads/` and the website serves it from `mydoorstep.com.co/downloads/…`.
   - It commits the new `public/app-release.json` and `public/assetlinks.json`.
4. In VS Code: **Pull** (to get that commit), then **deploy the website** as usual.
5. Open **mydoorstep.com.co/download** on an Android phone: the green **Download for Android** button appears with
   the new version, size and date. Install it once to check (see the steps on that page).
   For the **admin** app, the **Download** button appears on the admin dashboard instead (release `admin-android-v…`,
   file `DOORSTEP-Admin-x.y.z.apk`, details in `public/admin-app-release.json`).

### Check it

- `https://mydoorstep.com.co/.well-known/assetlinks.json` shows your fingerprint (not `[]`).
- The installed app opens **without** an address bar. If a bar shows, the assetlinks file isn't live yet — deploy
  the website, then close and reopen the app.
- Checksum on Windows: `Get-FileHash .\DOORSTEP-1.0.0.apk -Algorithm SHA256` must equal the SHA-256 on the page.

### If the first run fails

The workflow uses Google's Bubblewrap tool without a person at the keyboard. If a step fails, open the failed step's
log — the most common causes are a missing secret (the "Check the signing secrets" step names it) or a wrong key
alias (must be `doorstep`). You can also build on your laptop instead: `npx @bubblewrap/cli build` inside the
`android` folder (it asks for the passwords), then upload the `.apk`/`.aab` to a GitHub Release by hand.

---

## Google Play later (one-time US$25 developer fee)

1. Create a Google Play Console account and a new app with package name `co.com.mydoorstep.app`.
2. Upload `DOORSTEP-x.y.z.aab` from the GitHub Release. Let Google manage the app signing key ("Play App Signing").
3. Play then re-signs the app with **its own** key. Copy the **SHA-256** from Play Console → *App integrity* and add
   it to `public/assetlinks.json` as a second fingerprint (keep your own one too), then deploy the website — otherwise
   the Play version shows an address bar.
4. Fill in the store listing from `docs/APP_DISTRIBUTION.md` and a real privacy policy (see that file).

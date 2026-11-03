# DOORSTEP Admin for Android

The admin control panel as its own Android app: **DOORSTEP Admin** (package `co.com.mydoorstep.admin`). It opens
mydoorstep.com.co/admin full-screen with the dark green "ADMIN" icon, shows admin notifications, and installs next
to the customer DOORSTEP app without replacing it. Signing in still needs an admin account — the app contains no
passwords or keys.

| File | What it is |
|---|---|
| `android-admin/twa-manifest.json` | App settings: name, package id, colours, icon, start page (`/admin/dashboard`). |
| `public/admin-app-release.json` | Version, size, SHA-256 and link shown on the admin dashboard. Written by the workflow. |

It is built by the same workflow and signed with the same key as the customer app — see `android/README.md` for the
one-time setup. To release it: GitHub → **Actions** → **Android app** → **Run workflow**, choose **admin**, type a
new version (e.g. `1.0.0`), then pull and deploy the website. The admin dashboard then shows a
**Download for Android** button. The download link isn't listed on the public /download page.

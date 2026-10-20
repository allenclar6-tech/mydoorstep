# Release checklist — 20 Oct 2026

Do this on your computer, in VS Code, with the terminal open in the `DOORSTEP` folder (PowerShell). Do the
steps in order. **Stop at any red ✗ and send Claude the error text.** Don't paste keys, passwords or
`.env` contents.

**This release contains:**
- order cancel/delete
- delivery pricing calculator
- payment-methods page
- Sapele address directory (with today's Ugbeyi / Ajogodo fixes)
- live delivery: automatic rider offers, delivery code, restaurant board, dispatch board
- Locations directory: 36 candidates, verification, coverage, rider local checks

**Database changes it applies on deploy** (whichever are not already applied):
- `20261020120000_order_cancellation`
- `20261020130000_delivery_pricing`
- `20261020170000_live_dispatch`
- `20261020180000_location_directory`
- any earlier migration still pending (Render's log lists them)

All of these add tables or columns. None deletes data.

---

## Part A: Check the code on your computer (about 10 min)

**1. Close open files without saving.** In VS Code: *File → Close All*. If it asks to save
`server/sapeleDirectory.js` (or anything else), choose **Don't Save**. An old open copy would undo today's
changes.

**2. See what changed.**
```powershell
git status
git branch --show-current
```
You should see the files from this release as modified or new.
- The branch should be your working branch, not `main`. If it says `main`, run
  `git switch -c release/2026-10-20` first.
- `.env` must **not** be listed. It's ignored on purpose.

**3. Install exactly what the lock file says.**
```powershell
npm.cmd ci
```
✓ ends with "added … packages". ✗ an error → send it to Claude.

**4. Check the database schema.**
```powershell
npm.cmd run db:validate
```
✓ "The schema at prisma/schema.prisma is valid 🚀"

**5. Run all the tests.**
```powershell
npm.cmd test
```
✓ The last lines show `# fail 0`. ✗ any `not ok` → copy the lines around it to
Claude.

**6. Build the website.**
```powershell
npm.cmd run build
```
✓ ends with "built in …" and no red errors.

**7. Quick look locally (optional, but worth it).**
```powershell
npm.cmd run preview
```
Open the address it prints and click around the home page. Press `Ctrl+C` to stop. (Admin and ordering need
the real API, so test them after deploy.)

---

## Part B: Back up the live database (about 5 min)

**8.** Render dashboard → your **PostgreSQL** database → **Backups / Exports** → **Create export**.
- Wait until it's ready, then download it.
- Keep it private, **not** in the DOORSTEP folder or GitHub.

Don't continue without a fresh backup.

---

## Part C: Render settings (about 5 min)

**9.** Render → your **API web service** → **Environment**. Check these exist. Don't print or share their
values.

| Variable | Needed for | If missing |
|---|---|---|
| `MAPBOX_SERVER_TOKEN` | Real road distances for delivery prices | Prices fall back to straight-line estimates (still works, less accurate). Create a **secret** token in your Mapbox account and paste it **only into Render**. |
| `PAYSTACK_SECRET_KEY` | Payments and refunds | Already set if payments work today. |
| `LOCATION_REVIEWER_EMAILS` | Optional: who may approve locations | Leave unset = every admin can approve. Or set e.g. `you@example.com` |
| `DELIVERY_CODE_SECRET` | Optional | Leave unset; the app makes and stores its own. |
| `DISPATCH_SWEEP` | Leave **unset** | Setting it to `off` disables automatic rider offers. |

Save. If Render redeploys immediately, that's fine: it redeploys the current live code with the new settings.

---

## Part D: Deploy (about 15 min)

**10. Commit and push the release branch.**
```powershell
git add -A
git status
```
Check the list once more: **no `.env` files, no backups, no `private-uploads`**. Then:
```powershell
git commit -m "Release 2026-10-20: live delivery, pricing calculator, locations directory"
git push -u origin HEAD
```

**11. Merge to `main`.** On GitHub, open a Pull Request from your branch into `main` and merge it.
- Render auto-deploys `main`. Confirm under Render → service → **Settings → Branch** that it says `main`.

**12. Watch the Render deploy log** (service → **Events / Logs**). You want to see, in order:
- `[database] migrations_ready`
- `[database] location_candidates {"candidates":36,"created":36,"alreadyPresent":0}` (on later deploys,
  `created` is 0)
- the server starting

If you see **"Production database does not match the reviewed baseline"** or any migration error, Render keeps
the old version running. Send Claude the log lines and **don't retry blindly**.

**13. Check the API is healthy.** Open in your browser:
- `https://mydoorstep.com.co/api/health` → `"status":"ok"`
- `https://mydoorstep.com.co/api/ready` → `"status":"ready","database":"ok"`

**14. Deploy the website (Cloudflare).** Back in VS Code:
```powershell
npm.cmd run build
npm.cmd run cloudflare:deploy
```
✓ Wrangler prints a new version ID. If it asks you to log in, follow its browser prompt yourself.

---

## Part E: Live checks on two phones (about 30 min)

Use phone A as **customer**, phone B as **rider**, and your computer as **admin** (sign in yourself).

**15. Admin › Locations:** the page loads, the map shows coloured pins, and you can switch map styles. 36
records, 0 verified. Try **Export CSV**.

**16. Admin › Delivery pricing:**
- Enter your real rates (base fee, per-km, rider bands, service fee).
- Run the calculator on a known trip.
- Press **Publish** when the numbers look right.
- Keep "Only accept addresses inside approved zones" **off** for now.

**17. Real order (small amount, e.g. ₦500 item):**
1. Customer orders and pays with a real card.
2. Restaurant accepts.
3. The rider sees the offer and accepts.
4. The customer sees the rider and ETA.
5. The rider picks up.
6. The customer reads the 4-digit code.
7. The rider enters it → delivered.

Check in Admin › Money that the payment and rider pay are recorded.

**18. Refund path:** place a second small order and have the restaurant **decline** it. The customer should be
refunded. Check that it shows in Paystack.

**19. Rider › Local checks:** submit one check for a place you know. In Admin › Locations, accept it.

If anything fails, write down what you pressed and what you saw (a screenshot is best) and send it to Claude.

---

## Rollback (if something is badly wrong)

- **Website:** Cloudflare dashboard → Workers → `mydoorstep-site-20260922` → **Deployments** → roll back to the
  previous version.
- **API:** Render → service → **Events** → previous deploy → **Rollback**. The new tables can stay; the old
  code ignores them.
- **Database:** restore the backup from step 8 **only** if data was damaged. Ask Claude first; a restore
  loses orders placed since the backup.

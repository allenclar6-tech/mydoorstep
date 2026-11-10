# Deploy prompt — 10 Nov update (staff roles, business deals, dispatch control, routing, road reports)

Paste everything below the line into the Claude chat in VS Code, with the DOORSTEP folder open.

---

You are working in my DOORSTEP project (this folder). An update was just saved into it: staff roles, business delivery deals, dispatch control and a delivery overview, road routing with rider road reports, night/difficult-access charges, rider waiting pay, scheduled price changes, and demand-based pricing (off). Read docs/DISPATCH_AND_ROLES.md first. If the 9 Nov update (docs/DEPLOY_PROMPT_9NOV.md) hasn't been deployed yet, this deploy includes it too. Prepare it for deployment and deploy it. Rules:

- Never print, paste or commit the values in any .env file (.env, .env.local, .env.production, .env.TXT or similar). Never put secret keys in VITE_ variables or frontend code.
- Don't run destructive database commands (no `prisma migrate reset`, `db push --force-reset`, DROP, TRUNCATE or deleting data).
- Don't install new npm packages.
- Don't add any way for customers to negotiate or ask for a better delivery price, and don't switch on demand-based pricing (docs/DISPATCH_AND_ROLES.md, "Permanent business rules").
- Report honestly: only say a test or build passed if you ran it and saw it pass.

Steps:

1. Run `git status` and show me the list of changed and new files. Make sure no .env file is staged or tracked; if one is not ignored, add it to .gitignore (don't show its contents).
2. Run `npx prisma validate` and `npx prisma generate`. Fix only real errors in the schema, and tell me what you changed.
3. Run `npm test`. If a test fails, show me the failure, fix the cause in the code (not by weakening the test), and run it again. `tests/businessRules.test.js` must pass unchanged.
4. Run `npm run build` and fix any build errors the same way.
5. Check the new migrations are additive only (no DROP/DELETE/ALTER ... DROP): every folder in `prisma/migrations` starting with `20261109` or `20261110`.
6. Show me a short summary of the results, then STOP and ask me: "Have you backed up the database in Coolify? Shall I commit and push?" Wait for my yes.
7. After I say yes: create a commit with the message "Staff roles, business delivery deals, dispatch control, routing and road reports (10 Nov)" containing only project files (no .env, no dist, no node_modules, no signing keys, no screenshots), then `git push` to the branch Coolify deploys from (check `git branch --show-current` and tell me which branch).
8. Then tell me exactly what to click in Coolify: redeploy the API application (Dockerfile; it runs `node server/migrate.js` on start, which applies the new migrations) and then the website application (Dockerfile.web). Tell me which log lines to look for (`[database]` lines and no errors). Optional: tell me where to add `ROUTING_PROVIDERS=osrm,mapbox` and `OSRM_URL` on the API application, and point me to docs/ROUTING.md for setting up the free OSRM server on ZimaOS. Don't ask me to paste any key into the chat.
9. Finally give me this checklist to test on the live site:
   - Admin sign-in still works. The menu shows "Staff & roles", "Delivery overview", "Business delivery deals" and "Road reports". The top shows "Super admin".
   - Admin › Staff & roles: add a test staff member as "Dispatch operator", sign in as them (set a password with "Forgot password"), and check they only see the dispatch pages. Then suspend them.
   - Admin › Delivery prices › Fees & rider rates: "Demand-based pricing" shows OFF. The night charge, waiting pay and "Only deliver inside approved delivery areas" are there. The routing line at the top says which routing is active.
   - Admin › Delivery prices: test the scheduling with a small change set to switch on in 5 minutes, check the banner, then cancel it.
   - Admin › Business delivery deals: open a business, choose "Shared" 50%, check the preview split, then set it back to "Standard".
   - Admin › Delivery overview loads for "Last 7 days".
   - Rider app › Road reports: send a test report. Admin › Road reports: approve it.
   - On a test order with a rider before pickup: Admin › Live deliveries › "Take off / reassign" works.
   - Customer checkout to an exact-pin address still shows the fee straight away. An unsure address still shows "To be confirmed", and the customer only gets Accept and Decline.

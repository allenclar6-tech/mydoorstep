# Deploy prompt — 9 Nov update (delivery pricing & quotes + order chat)

Paste everything below the line into the Claude chat in VS Code, with the DOORSTEP folder open.

---

You are working in my DOORSTEP project (this folder). An update was just saved into it: delivery pricing with manual quotes (docs/DELIVERY_QUOTES.md) and order chat between customer, rider and store (docs/ORDER_CHAT.md). Prepare it for deployment and deploy it. Rules:

- Never print, paste or commit the values in any .env file (.env, .env.local, .env.production, .env.TXT or similar). Never put secret keys in VITE_ variables or frontend code.
- Don't run destructive database commands (no `prisma migrate reset`, `db push --force-reset`, DROP, TRUNCATE or deleting data).
- Don't install new npm packages.
- Report honestly: only say a test or build passed if you ran it and saw it pass.

Steps:

1. Run `git status` and show me the list of changed and new files. Make sure no .env file is staged or tracked; if one is not ignored, add it to .gitignore (don't show its contents).
2. Run `npx prisma validate` and `npx prisma generate`. Fix only real errors in the schema, and tell me what you changed.
3. Run `npm test`. If a test fails, show me the failure, fix the cause in the code (not by weakening the test), and run it again.
4. Run `npm run build` and fix any build errors the same way.
5. Check the two new migrations look additive only (no DROP/DELETE): `prisma/migrations/20261109100000_delivery_quotations` and `prisma/migrations/20261109120000_order_chat`.
6. Show me a short summary of the results, then STOP and ask me: "Have you backed up the database in Coolify? Shall I commit and push?" Wait for my yes.
7. After I say yes: create a commit with the message "Delivery pricing quotes and order chat (9 Nov)" containing only project files (no .env, no dist, no node_modules, no signing keys), then `git push` to the branch Coolify deploys from (check `git branch --show-current` and tell me which branch).
8. Then tell me exactly what to click in Coolify: redeploy the API application (Dockerfile; it runs `node server/migrate.js` on start, which applies the two new migrations) and then the website application (Dockerfile.web). Tell me which log lines to look for (`[database]` lines and no errors).
9. Finally give me this checklist to test on the live site:
   - Admin › Delivery prices loads (new cards: fixed price per area, extras, manual prices).
   - Admin › Prices to confirm loads (empty list is fine).
   - Admin › Customers › Order chats loads.
   - Place a test order to an address with no map pin → it shows "Delivery: To be confirmed" and appears in Prices to confirm → send a price → accept it as the customer → Pay now appears.
   - On an order with a rider assigned: customer opens "Chat with your rider", sends a quick reply; the rider sees it on the current job and replies; ticks turn green when read.
